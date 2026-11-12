/* src/lib/server/moderation/actions.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig } from '../config.ts';
import { recordAction } from '../db/auditLog.ts';
import {
	claimFinding,
	getFinding,
	setFindingStatus,
	updateFindingEvidence
} from '../db/findings.ts';
import { upsertPullRequest } from '../db/pullRequests.ts';
import { emitFindingEvent } from '../events.ts';
import { getPullRequest } from '../github/pullRequests.ts';
import { createLogger, describeError } from '../logger.ts';
import { getRule } from '../rules/index.ts';
import type {
	ActionOutcome,
	ActionSource,
	ActionType,
	FindingStatus,
	FindingWithPullRequest
} from '../types.ts';
import { evaluatePullRequest } from './evaluate.ts';
import { executors } from './executors.ts';

const logger = createLogger('actions');

export type ModerationDecision = 'approve' | 'ignore';

interface Resolution {
	outcome: ActionOutcome;
	findingStatus: FindingStatus;
}

// Runs with the finding already claimed; decides what happens and where the finding ends up
async function resolveDecision(
	finding: FindingWithPullRequest,
	decision: ModerationDecision
): Promise<Resolution> {
	if (decision === 'ignore') {
		return {
			findingStatus: 'ignored',
			outcome: {
				status: 'success',
				summary: 'Ignored. No action was taken on GitHub.'
			}
		};
	}

	// Revalidate against the latest commit before touching anything
	const pullRequest = await getPullRequest(finding.prNumber, true);

	upsertPullRequest(pullRequest);

	if (pullRequest.state !== 'open') {
		return {
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

	const violation = evaluation.violations.find(
		(candidate) => candidate.ruleId === finding.ruleId && candidate.filePath === finding.filePath
	);

	if (!violation) {
		return {
			findingStatus: 'resolved',
			outcome: {
				status: 'skipped',
				summary: 'The latest commit no longer has this violation. Nothing was done.'
			}
		};
	}

	updateFindingEvidence(finding.id, pullRequest.headSha, violation.reason);

	const rule = getRule(finding.ruleId);

	if (getConfig().dryRun) {
		return {
			findingStatus: 'pending',
			outcome: {
				status: 'dryRun',
				summary: `Dry run: would have run "${rule.actionLabel}" on #${pullRequest.number}.`
			}
		};
	}

	const outcome = await executors[rule.actionType]({
		pullRequest,
		finding,
		evaluation
	});

	return {
		findingStatus: 'actioned',
		outcome
	};
}

// The single entry point for Discord buttons and dashboard buttons alike
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

	if (!claimFinding(finding.id)) {
		return {
			status: 'skipped',
			summary: `Already handled (status: ${finding.status}).`
		};
	}

	const rule = getRule(finding.ruleId);
	const actionType: ActionType = options.decision === 'ignore' ? 'ignore' : rule.actionType;

	let resolution: Resolution;

	try {
		resolution = await resolveDecision(finding, options.decision);
	} catch (error) {
		logger.error(`Action on finding ${finding.id} failed`, error);

		// Back to pending so it can be retried; the retry revalidates from scratch
		resolution = {
			findingStatus: 'pending',
			outcome: {
				status: 'failure',
				summary: `Failed: ${describeError(error)}`
			}
		};
	}

	const { outcome, findingStatus } = resolution;

	setFindingStatus(finding.id, findingStatus, outcome.summary);

	recordAction({
		findingId: finding.id,
		prNumber: finding.prNumber,
		contributor: finding.author,
		ruleId: finding.ruleId,
		actionType,
		source: options.source,
		status: outcome.status,
		detail: outcome.summary,
		githubUrl: outcome.githubUrl ?? null
	});

	emitFindingEvent('findingChanged', finding.id);

	return outcome;
}
