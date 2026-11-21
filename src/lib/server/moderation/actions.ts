/* src/lib/server/moderation/actions.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig } from '../config.ts';
import { recordAction } from '../db/auditLog.ts';
import {
	claimFinding,
	getFinding,
	listFindingsForPullRequest,
	setFindingStatus,
	updateFindingEvidence
} from '../db/findings.ts';
import { upsertPullRequest } from '../db/pullRequests.ts';
import { emitFindingEvent } from '../events.ts';
import { getPullRequest } from '../github/pullRequests.ts';
import { createLogger, describeError } from '../logger.ts';
import { bySeverity, getRule } from '../rules/index.ts';
import type {
	ActionOutcome,
	ActionSource,
	ActionType,
	FindingRow,
	FindingStatus
} from '../types.ts';
import { evaluatePullRequest } from './evaluate.ts';
import { executors } from './executors.ts';

const logger = createLogger('actions');

export type ModerationDecision = 'approve' | 'ignore';

interface Resolution {
	outcome: ActionOutcome;
	actionType: ActionType;
	findingStatus: FindingStatus;
	// Findings the latest commit no longer violates
	fixedIds?: Set<number>;
}

function chooseAction(findings: FindingRow[]): Exclude<ActionType, 'ignore'> {
	// A closure settles every other issue on the PR
	return findings.some((finding) => getRule(finding.ruleId).actionType === 'closePr')
		? 'closePr'
		: 'requestChanges';
}

// Runs with the findings already claimed; decides what happens and where they end up
async function resolveDecision(
	group: FindingRow[],
	decision: ModerationDecision
): Promise<Resolution> {
	if (decision === 'ignore') {
		return {
			actionType: 'ignore',
			findingStatus: 'ignored',
			outcome: {
				status: 'success',
				summary: `Ignored ${group.length} issue(s). No action was taken on GitHub.`
			}
		};
	}

	const [lead] = group;
	const plannedAction = chooseAction(group);

	// Revalidate against the latest commit before touching anything
	const pullRequest = await getPullRequest(lead.repo, lead.prNumber, true);

	upsertPullRequest(pullRequest);

	if (pullRequest.state !== 'open') {
		return {
			actionType: plannedAction,
			findingStatus: 'prClosed',
			outcome: {
				status: 'skipped',
				summary: 'The pull request is no longer open. Nothing was done.'
			}
		};
	}

	const evaluation = await evaluatePullRequest(pullRequest, {
		fresh: true,
		priority: true
	});

	const stillViolated: FindingRow[] = [];
	const fixedIds = new Set<number>();

	for (const finding of group) {
		const violation = evaluation.violations.find(
			(candidate) => candidate.ruleId === finding.ruleId && candidate.filePath === finding.filePath
		);

		if (violation) {
			updateFindingEvidence(finding.id, pullRequest.headSha, violation.reason);
			stillViolated.push(finding);
		} else {
			fixedIds.add(finding.id);
		}
	}

	if (stillViolated.length === 0) {
		return {
			actionType: plannedAction,
			findingStatus: 'resolved',
			outcome: {
				status: 'skipped',
				summary: 'The latest commit no longer has these violations. Nothing was done.'
			}
		};
	}

	const actionType = chooseAction(stillViolated);

	if (getConfig().dryRun) {
		return {
			actionType,
			fixedIds,
			findingStatus: 'pending',
			outcome: {
				status: 'dryRun',
				summary:
					`Dry run: would have run "${getRule(stillViolated[0].ruleId).actionLabel}" ` +
					`on #${pullRequest.number} for ${stillViolated.length} issue(s).`
			}
		};
	}

	const outcome = await executors[actionType]({
		pullRequest,
		findings: stillViolated,
		evaluation
	});

	return {
		actionType,
		fixedIds,
		findingStatus: 'actioned',
		outcome
	};
}

// The single entry point for Discord buttons and dashboard buttons alike.
// One decision covers every pending finding on the finding's pull request.
export async function performModerationAction(options: {
	findingId: number;
	decision: ModerationDecision;
	source: ActionSource;
}): Promise<ActionOutcome> {
	const finding = getFinding(options.findingId);

	if (!finding) {
		return {
			status: 'failure',
			summary: 'That finding no longer exists.'
		};
	}

	// Each claim is atomic, so two presses can never act on the same finding
	const group = listFindingsForPullRequest(finding.repo, finding.prNumber)
		.filter((candidate) => candidate.status === 'pending' && claimFinding(candidate.id))
		.sort(bySeverity);

	if (group.length === 0) {
		return {
			status: 'skipped',
			summary: `Already handled (status: ${finding.status}).`
		};
	}

	let resolution: Resolution;

	try {
		resolution = await resolveDecision(group, options.decision);
	} catch (error) {
		logger.error(`Action on ${finding.repo}#${finding.prNumber} failed`, error);

		// Back to pending so it can be retried; the retry revalidates from scratch
		resolution = {
			actionType: options.decision === 'ignore' ? 'ignore' : chooseAction(group),
			findingStatus: 'pending',
			outcome: {
				status: 'failure',
				summary: `Failed: ${describeError(error)}`
			}
		};
	}

	const { outcome, findingStatus, fixedIds } = resolution;

	for (const member of group) {
		if (fixedIds?.has(member.id)) {
			setFindingStatus(member.id, 'resolved', 'The latest commit no longer has this violation.');
		} else {
			setFindingStatus(member.id, findingStatus, outcome.summary);
		}

		emitFindingEvent('findingChanged', member.id);
	}

	// One audit row per decision, led by the most serious finding
	recordAction({
		findingId: group[0].id,
		repo: finding.repo,
		prNumber: finding.prNumber,
		contributor: finding.author,
		ruleId: group[0].ruleId,
		actionType: resolution.actionType,
		source: options.source,
		status: outcome.status,
		detail: outcome.summary,
		githubUrl: outcome.githubUrl ?? null
	});

	return outcome;
}
