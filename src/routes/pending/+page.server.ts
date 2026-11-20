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

export const load: PageServerLoad = ({ url }) => {
	const openFindings = listOpenFindings(readRepoFilter(url)).sort(bySeverity);

	const findings = openFindings.map((finding) => ({
		id: finding.id,
		repo: finding.repo,
		prNumber: finding.prNumber,
		title: finding.title,
		author: finding.author,
		url: finding.url,
		ruleId: finding.ruleId,
		filePath: finding.filePath,
		reason: finding.reason,
		status: finding.status,
		lastOutcome: finding.lastOutcome,
		createdAt: finding.createdAt,
		actionLabel: getRule(finding.ruleId).actionLabel,
		actionType: getRule(finding.ruleId).actionType,
		severity: getRule(finding.ruleId).severity,
		otherRuleIds: openFindings
			.filter(
				(other) =>
					other.repo === finding.repo &&
					other.prNumber === finding.prNumber &&
					other.id !== finding.id
			)
			.map((other) => other.ruleId)
	}));

	return { findings };
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
