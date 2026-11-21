/* src/lib/server/moderation/executors.ts
 * MIT — (c) Doughmination System®
 */

import { repoLabel } from '../../labels.ts';
import { getConfig } from '../config.ts';
import { listFindingsForPullRequest, setFindingComment, setFindingStatus } from '../db/findings.ts';
import { markPullRequestClosed } from '../db/pullRequests.ts';
import { emitFindingEvent } from '../events.ts';
import { getCommentableLines } from '../github/diff.ts';
import { GitHubError } from '../github/client.ts';
import {
	addIssueLabels,
	closePullRequest,
	createChangesRequestedReview,
	createIssueComment,
	dismissReview,
	getAuthenticatedLogin,
	listReviews
} from '../github/pullRequests.ts';
import { getMessages } from '../messages.ts';
import { getRule } from '../rules/index.ts';
import { vercelFileFor } from '../rules/vercelVerification.ts';
import type { Violation } from '../rules/types.ts';
import type { ActionOutcome, ActionType, FindingRow, PullRequestSummary } from '../types.ts';
import type { Evaluation } from './evaluate.ts';
import { retireFindings } from './reconcile.ts';

export interface ExecutorInput {
	pullRequest: PullRequestSummary;
	// Every finding on the PR that is still violated, decided together
	findings: FindingRow[];
	evaluation: Evaluation;
}

type Executor = (input: ExecutorInput) => Promise<ActionOutcome>;

// Wording placeholders that depend on the repository and the file
function fillWording(text: string, repo: string, filePath: string): string {
	return text
		.replaceAll('{service}', repoLabel(repo))
		.replaceAll('{vercelFile}', vercelFileFor(filePath, repo));
}

// The automated-tool footer, so a combined review carries it once
function withoutFooter(text: string): string {
	return text.replace(/\n*<sub>[\s\S]*<\/sub>\s*$/, '');
}

function findingKey(item: { ruleId: string; filePath: string }): string {
	return `${item.ruleId}:${item.filePath}`;
}

async function closeWithPolicyComment(input: ExecutorInput): Promise<ActionOutcome> {
	const { pullRequest, findings } = input;
	const { repo, number } = pullRequest;
	const closingFinding =
		findings.find((finding) => finding.ruleId === 'unsupportedCname') ??
		findings.find((finding) => getRule(finding.ruleId).actionType === 'closePr');

	if (!closingFinding) {
		throw new Error('Closing needs a closePr finding.');
	}

	const unsupported = closingFinding.ruleId === 'unsupportedCname';

	if (unsupported) {
		await addIssueLabels(repo, number, ['status: denied', 'reason: incompatible records']);
	}

	// A stored comment id means an earlier attempt already explained; never explain twice
	if (closingFinding.commentId === null) {
		const comment = await createIssueComment(
			repo,
			number,
			fillWording(
				unsupported
					? getMessages().unsupportedCname.closeComment
					: getMessages().nsRecords.closeComment,
				repo,
				closingFinding.filePath
			)
		);

		setFindingComment(closingFinding.id, comment.id);
	}

	await closePullRequest(repo, number);

	markPullRequestClosed(repo, number);
	retireFindings(repo, number, 'The pull request was closed through the tool.');

	const others = findings.length - 1;

	return {
		status: 'success',
		summary:
			(unsupported
				? `Closed #${number}: denied, incompatible records (unsupported host)`
				: `Closed #${number} with the NS policy explanation`) +
			(others > 0 ? `, settling ${others} other issue(s) with it.` : '.'),
		githubUrl: pullRequest.url
	};
}

function reviewMarker(finding: { ruleId: string; filePath: string }): string {
	return `<!-- isATracker:${finding.ruleId}:${finding.filePath} -->`;
}

// Recognize reviews posted before the project was renamed.
const markerPattern = /<!-- (?:isATracker|is-a-tracker):([^:]+):(.+?) -->/g;

function reviewMessages(finding: FindingRow) {
	const messages = getMessages();

	if (finding.ruleId === 'nsRecords') {
		throw new Error('NS findings close the PR; they have no review wording.');
	}

	return messages[finding.ruleId];
}

// One review for every finding: inline where GitHub allows it, the rest in the body
async function requestRuleChanges(input: ExecutorInput): Promise<ActionOutcome> {
	const { pullRequest, findings, evaluation } = input;
	const { repo, number, headSha } = pullRequest;
	const markers = findings.map(reviewMarker);

	const login = await getAuthenticatedLogin();
	const reviews = await listReviews(repo, number);

	const duplicate = reviews.find(
		(review) =>
			review.user?.login === login &&
			review.state === 'CHANGES_REQUESTED' &&
			review.commit_id === headSha &&
			markers.every((marker) =>
				(review.body ?? '').replaceAll('is-a-tracker:', 'isATracker:').includes(marker)
			)
	);

	if (duplicate) {
		return {
			status: 'skipped',
			summary: 'Changes were already requested for these issues on this commit.',
			githubUrl: duplicate.html_url
		};
	}

	const placed = findings.map((finding) => {
		const file = evaluation.files.find((candidate) => candidate.path === finding.filePath);
		const findLine = getRule(finding.ruleId).findLine;
		const line = file && findLine ? findLine(file) : null;
		const commentable = line !== null && getCommentableLines(file?.patch).has(line);

		return {
			finding,
			line: commentable ? line : null
		};
	});

	const comment = (finding: FindingRow) =>
		fillWording(reviewMessages(finding).reviewComment, repo, finding.filePath);

	// Rules without a line (like vercelLogin) are about the PR, not a file
	const fileNote = (finding: FindingRow) =>
		getRule(finding.ruleId).findLine ? `\n\nFile: \`${finding.filePath}\`` : '';

	const buildReview = (allowInline: boolean) => {
		const inline = placed.filter((item) => allowInline && item.line !== null);
		const inBody = placed.filter((item) => !inline.includes(item));
		let text: string;

		if (findings.length === 1) {
			const [only] = findings;

			text =
				inline.length === 1
					? reviewMessages(only).reviewSummary
					: `${comment(only)}${fileNote(only)}`;
		} else {
			text = [
				...inBody.map((item) => `${withoutFooter(comment(item.finding))}${fileNote(item.finding)}`),
				getMessages().combined.reviewSummary
			].join('\n\n');
		}

		return {
			inlineCount: inline.length,
			body: `${text}\n\n${markers.join('\n')}`,
			comments: inline.map((item) => ({
				path: item.finding.filePath,
				line: item.line as number,
				side: 'RIGHT' as const,
				body: comment(item.finding)
			}))
		};
	};

	let review = buildReview(true);
	let created;

	try {
		created = await createChangesRequestedReview({
			repo,
			number,
			commitId: headSha,
			body: review.body,
			comments: review.comments
		});
	} catch (error) {
		// 422 means GitHub refused a line position; fall back to a body-only review
		if (review.comments.length === 0 || !(error instanceof GitHubError) || error.status !== 422) {
			throw error;
		}

		review = buildReview(false);

		created = await createChangesRequestedReview({
			repo,
			number,
			commitId: headSha,
			body: review.body,
			comments: []
		});
	}

	const inBodyCount = findings.length - review.inlineCount;

	return {
		status: 'success',
		summary:
			`Requested changes on #${number}: ${review.inlineCount} inline comment(s)` +
			`, ${inBodyCount} in the review body.`,
		githubUrl: created.html_url
	};
}

// Dismisses our change requests once the latest commit fixes every issue a review raised
export async function dismissFixedChangeRequests(
	pullRequest: PullRequestSummary,
	violations: Violation[]
): Promise<void> {
	const { repo, number } = pullRequest;
	const stillViolated = new Set(violations.map(findingKey));

	const fixed = listFindingsForPullRequest(repo, number).filter(
		(finding) =>
			finding.status === 'actioned' &&
			// Older unsupported-host findings may still have a change-request review.
			(getRule(finding.ruleId).actionType === 'requestChanges' ||
				finding.ruleId === 'unsupportedCname') &&
			!stillViolated.has(findingKey(finding))
	);

	if (fixed.length === 0 || getConfig().dryRun) {
		return;
	}

	const login = await getAuthenticatedLogin();
	const reviews = await listReviews(repo, number);

	for (const review of reviews) {
		if (review.user?.login !== login || review.state !== 'CHANGES_REQUESTED') {
			continue;
		}

		const keys = [...(review.body ?? '').matchAll(markerPattern)].map(
			(match) => `${match[1]}:${match[2]}`
		);

		const covered = fixed.filter((finding) => keys.includes(findingKey(finding)));

		// A combined review stays until every issue it raised is fixed
		if (covered.length === 0 || keys.some((key) => stillViolated.has(key))) {
			continue;
		}

		const message = [
			...new Set(covered.map((finding) => reviewMessages(finding).reviewDismissal))
		].join('\n\n');

		await dismissReview(repo, number, review.id, message);
	}

	for (const finding of fixed) {
		setFindingStatus(
			finding.id,
			'resolved',
			'The contributor fixed this; its review is dismissed once all of its issues are fixed.'
		);
		emitFindingEvent('findingChanged', finding.id);
	}
}

export const executors: Record<Exclude<ActionType, 'ignore'>, Executor> = {
	closePr: closeWithPolicyComment,
	requestChanges: requestRuleChanges
};
