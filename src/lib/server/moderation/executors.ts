/* src/lib/server/moderation/executors.ts
 * MIT — (c) Doughmination System®
 */

import { setFindingComment } from '../db/findings.ts';
import { markPullRequestClosed } from '../db/pullRequests.ts';
import { getCommentableLines } from '../github/diff.ts';
import { GitHubError } from '../github/client.ts';
import {
	closePullRequest,
	createChangesRequestedReview,
	createIssueComment,
	getAuthenticatedLogin,
	listReviews
} from '../github/pullRequests.ts';
import { getMessages } from '../messages.ts';
import { findNoReplyEmail, findOwnerEmailLine } from '../rules/noReplyEmail.ts';
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

	// A stored comment id means an earlier attempt already explained; never explain twice
	if (finding.commentId === null) {
		const comment = await createIssueComment(
			pullRequest.number,
			getMessages().nsRecords.closeComment
		);

		setFindingComment(finding.id, comment.id);
	}

	await closePullRequest(pullRequest.number);

	markPullRequestClosed(pullRequest.number);
	retireFindings(pullRequest.number, 'The pull request was closed through the tool.');

	return {
		status: 'success',
		summary: `Closed #${pullRequest.number} with the NS policy explanation.`,
		githubUrl: pullRequest.url
	};
}

function reviewMarker(finding: FindingRow): string {
	return `<!-- is-a-tracker:${finding.ruleId}:${finding.filePath} -->`;
}

async function requestEmailChanges(input: ExecutorInput): Promise<ActionOutcome> {
	const { pullRequest, finding, evaluation } = input;
	const messages = getMessages().noReplyEmail;
	const marker = reviewMarker(finding);

	const login = await getAuthenticatedLogin();
	const reviews = await listReviews(pullRequest.number);

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
	const email = file ? findNoReplyEmail(file.json) : null;
	const line = file && email ? findOwnerEmailLine(file.content, email) : null;
	const canCommentInline = line !== null && getCommentableLines(file?.patch).has(line);

	const fallbackBody = `${messages.reviewComment}\n\nFile: \`${finding.filePath}\`\n\n${marker}`;

	if (canCommentInline) {
		try {
			const review = await createChangesRequestedReview({
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

export const executors: Record<Exclude<ActionType, 'ignore'>, Executor> = {
	closePr: closeWithPolicyComment,
	requestChanges: requestEmailChanges
};
