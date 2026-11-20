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
	closePullRequest,
	createChangesRequestedReview,
	createIssueComment,
	dismissReview,
	getAuthenticatedLogin,
	listReviews
} from '../github/pullRequests.ts';
import { getMessages } from '../messages.ts';
import { getRule } from '../rules/index.ts';
import type { Violation } from '../rules/types.ts';
import type { ActionOutcome, ActionType, FindingRow, PullRequestSummary } from '../types.ts';
import type { Evaluation } from './evaluate.ts';
import { retireFindings } from './reconcile.ts';

export interface ExecutorInput {
	pullRequest: PullRequestSummary;
	finding: FindingRow;
	evaluation: Evaluation;
}

type Executor = (input: ExecutorInput) => Promise<ActionOutcome>;

async function closeWithPolicyComment(input: ExecutorInput): Promise<ActionOutcome> {
	const { pullRequest, finding } = input;
	const { repo, number } = pullRequest;

	// A stored comment id means an earlier attempt already explained; never explain twice
	if (finding.commentId === null) {
		const comment = await createIssueComment(
			repo,
			number,
			getMessages().nsRecords.closeComment.replaceAll('{service}', repoLabel(repo))
		);

		setFindingComment(finding.id, comment.id);
	}

	await closePullRequest(repo, number);

	markPullRequestClosed(repo, number);
	retireFindings(repo, number, 'The pull request was closed through the tool.');

	return {
		status: 'success',
		summary: `Closed #${pullRequest.number} with the NS policy explanation.`,
		githubUrl: pullRequest.url
	};
}

function reviewMarker(finding: FindingRow): string {
	return `<!-- is-a-tracker:${finding.ruleId}:${finding.filePath} -->`;
}

function reviewMessages(finding: FindingRow) {
	const messages = getMessages();

	if (finding.ruleId === 'nsRecords') {
		throw new Error('NS findings close the PR; they have no review wording.');
	}

	return messages[finding.ruleId];
}

async function requestRuleChanges(input: ExecutorInput): Promise<ActionOutcome> {
	const { pullRequest, finding, evaluation } = input;
	const messages = reviewMessages(finding);
	const marker = reviewMarker(finding);

	const login = await getAuthenticatedLogin();
	const reviews = await listReviews(pullRequest.repo, pullRequest.number);

	const duplicate = reviews.find(
		(review) =>
			review.user?.login === login &&
			review.state === 'CHANGES_REQUESTED' &&
			review.commit_id === pullRequest.headSha &&
			(review.body ?? '').includes(marker)
	);

	if (duplicate) {
		return {
			status: 'skipped',
			summary: 'Changes were already requested for this file on this commit.',
			githubUrl: duplicate.html_url
		};
	}

	const file = evaluation.files.find((candidate) => candidate.path === finding.filePath);
	const findLine = getRule(finding.ruleId).findLine;
	const line = file && findLine ? findLine(file) : null;
	const canCommentInline = line !== null && getCommentableLines(file?.patch).has(line);

	// Rules without a line (like vercelLogin) are about the PR, not a file
	const fileNote = findLine ? `\n\nFile: \`${finding.filePath}\`` : '';
	const fallbackBody = `${messages.reviewComment}${fileNote}\n\n${marker}`;

	if (canCommentInline) {
		try {
			const review = await createChangesRequestedReview({
				repo: pullRequest.repo,
				number: pullRequest.number,
				commitId: pullRequest.headSha,
				body: `${messages.reviewSummary}\n\n${marker}`,
				comments: [
					{
						path: finding.filePath,
						line,
						side: 'RIGHT',
						body: messages.reviewComment
					}
				]
			});

			return {
				status: 'success',
				summary: `Requested changes on #${pullRequest.number} with an inline comment on line ${line}.`,
				githubUrl: review.html_url
			};
		} catch (error) {
			// 422 means GitHub refused the line position; fall through to a body-only review
			if (!(error instanceof GitHubError) || error.status !== 422) {
				throw error;
			}
		}
	}

	const review = await createChangesRequestedReview({
		repo: pullRequest.repo,
		number: pullRequest.number,
		commitId: pullRequest.headSha,
		body: fallbackBody,
		comments: []
	});

	return {
		status: 'success',
		summary: `Requested changes on #${pullRequest.number} in the review body (line not commentable).`,
		githubUrl: review.html_url
	};
}

// Dismisses our change requests once the latest commit no longer has the violation
export async function dismissFixedChangeRequests(
	pullRequest: PullRequestSummary,
	violations: Violation[]
): Promise<void> {
	const fixed = listFindingsForPullRequest(pullRequest.repo, pullRequest.number).filter(
		(finding) =>
			finding.status === 'actioned' &&
			getRule(finding.ruleId).actionType === 'requestChanges' &&
			!violations.some(
				(violation) =>
					violation.ruleId === finding.ruleId && violation.filePath === finding.filePath
			)
	);

	if (fixed.length === 0 || getConfig().dryRun) {
		return;
	}

	const login = await getAuthenticatedLogin();
	const reviews = await listReviews(pullRequest.repo, pullRequest.number);

	for (const finding of fixed) {
		const marker = reviewMarker(finding);

		const openReviews = reviews.filter(
			(review) =>
				review.user?.login === login &&
				review.state === 'CHANGES_REQUESTED' &&
				(review.body ?? '').includes(marker)
		);

		for (const review of openReviews) {
			await dismissReview(
				pullRequest.repo,
				pullRequest.number,
				review.id,
				reviewMessages(finding).reviewDismissal
			);
		}

		setFindingStatus(
			finding.id,
			'resolved',
			'The contributor fixed this; the requested changes were dismissed.'
		);
		emitFindingEvent('findingChanged', finding.id);
	}
}

export const executors: Record<Exclude<ActionType, 'ignore'>, Executor> = {
	closePr: closeWithPolicyComment,
	requestChanges: requestRuleChanges
};
