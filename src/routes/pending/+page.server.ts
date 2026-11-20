/* src/routes/pending/+page.server.ts
 * MIT — (c) Doughmination System®
 */

import { fail } from '@sveltejs/kit';

import { readRepoFilter } from '#lib/server/config.ts';
import { listOpenFindings } from '#lib/server/db/findings.ts';
import {
	performModerationAction,
	type ModerationDecision
} from '#lib/server/moderation/actions.ts';
import { bySeverity, getRule } from '#lib/server/rules/index.ts';

import type { Actions, PageServerLoad } from './$types';

// One card per PR, most serious first; its buttons act on every pending finding
export const load: PageServerLoad = ({ url }) => {
	const openFindings = listOpenFindings(readRepoFilter(url)).sort(bySeverity);
	const byPullRequest = new Map<string, typeof openFindings>();

	for (const finding of openFindings) {
		const key = `${finding.repo}#${finding.prNumber}`;

		byPullRequest.set(key, [...(byPullRequest.get(key) ?? []), finding]);
	}

	const pullRequests = [...byPullRequest].map(([key, findings]) => {
		const [lead] = findings;
		const pending = findings.filter((finding) => finding.status === 'pending');
		const closing = pending.find((finding) => getRule(finding.ruleId).actionType === 'closePr');
		const countNote = pending.length > 1 ? ` (${pending.length})` : '';

		return {
			key,
			repo: lead.repo,
			prNumber: lead.prNumber,
			title: lead.title,
			author: lead.author,
			url: lead.url,
			actionFindingId: pending[0]?.id ?? null,
			actionType: closing ? 'closePr' : 'requestChanges',
			actionLabel: closing
				? getRule(closing.ruleId).actionLabel
				: `${getRule(lead.ruleId).actionLabel}${countNote}`,
			ignoreLabel: pending.length > 1 ? 'Ignore all' : 'Ignore',
			lastOutcome: lead.lastOutcome,
			violations: findings.map((finding) => ({
				id: finding.id,
				ruleId: finding.ruleId,
				severity: getRule(finding.ruleId).severity,
				filePath: finding.filePath,
				reason: finding.reason,
				createdAt: finding.createdAt
			}))
		};
	});

	return { pullRequests };
};

// Same pipeline as the Discord buttons: claim, revalidate, act, audit
async function decide(request: Request, decision: ModerationDecision) {
	const formData = await request.formData();
	const findingId = Number(formData.get('findingId'));

	if (!Number.isInteger(findingId) || findingId <= 0) {
		return fail(400, {
			outcome: {
				status: 'failure',
				summary: 'Missing finding id.'
			}
		});
	}

	const outcome = await performModerationAction({
		findingId,
		decision,
		source: 'dashboard'
	});

	return { outcome };
}

export const actions: Actions = {
	approve: ({ request }) => decide(request, 'approve'),
	ignore: ({ request }) => decide(request, 'ignore')
};
