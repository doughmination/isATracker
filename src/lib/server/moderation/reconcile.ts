/* src/lib/server/moderation/reconcile.ts
 * MIT — (c) Doughmination System®
 */

import {
	insertFinding,
	listFindingsForPullRequest,
	reopenFinding,
	setFindingStatus,
	updateFindingEvidence
} from '../db/findings.ts';
import { emitFindingEvent } from '../events.ts';
import { getRule } from '../rules/index.ts';
import type { Violation } from '../rules/types.ts';
import type { FindingRow, PullRequestSummary } from '../types.ts';

function findingKey(item: { ruleId: string; filePath: string }): string {
	return `${item.ruleId}:${item.filePath}`;
}

function shouldReopen(finding: FindingRow): boolean {
	if (finding.status === 'resolved' || finding.status === 'prClosed') {
		return true;
	}

	// A PR that was closed through the tool and is open again needs a fresh decision
	return finding.status === 'actioned' && getRule(finding.ruleId).actionType === 'closePr';
}

// Brings stored findings in line with what the latest commit actually violates
export function reconcileFindings(pullRequest: PullRequestSummary, violations: Violation[]): void {
	const existing = new Map(
		listFindingsForPullRequest(pullRequest.number).map((finding) => [findingKey(finding), finding])
	);

	const violatedKeys = new Set<string>();

	for (const violation of violations) {
		const key = findingKey(violation);
		const finding = existing.get(key);

		violatedKeys.add(key);

		if (!finding) {
			const findingId = insertFinding({
				prNumber: pullRequest.number,
				ruleId: violation.ruleId,
				filePath: violation.filePath,
				headSha: pullRequest.headSha,
				reason: violation.reason
			});

			emitFindingEvent('findingCreated', findingId);
			continue;
		}

		if (finding.status === 'pending') {
			// Same unresolved violation on a newer commit: refresh quietly, no new ping
			updateFindingEvidence(finding.id, pullRequest.headSha, violation.reason);
			emitFindingEvent('findingChanged', finding.id);
			continue;
		}

		if (shouldReopen(finding)) {
			reopenFinding(finding.id, pullRequest.headSha, violation.reason);
			emitFindingEvent('findingCreated', finding.id);
		}
	}

	for (const finding of existing.values()) {
		if (finding.status === 'pending' && !violatedKeys.has(findingKey(finding))) {
			setFindingStatus(finding.id, 'resolved', 'The contributor fixed this in a later commit.');
			emitFindingEvent('findingChanged', finding.id);
		}
	}
}

// Retires every open finding of a PR that is no longer open
export function retireFindings(prNumber: number, explanation: string): void {
	for (const finding of listFindingsForPullRequest(prNumber)) {
		if (finding.status === 'pending') {
			setFindingStatus(finding.id, 'prClosed', explanation);
			emitFindingEvent('findingChanged', finding.id);
		}
	}
}
