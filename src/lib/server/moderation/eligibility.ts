/* src/lib/server/moderation/eligibility.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig } from '../config.ts';
import { getContributor, saveContributor } from '../db/contributors.ts';
import { countMergedPullRequests } from '../github/pullRequests.ts';
import type { ContributorEligibility } from '../rules/types.ts';
import type { PullRequestSummary } from '../types.ts';

const maintainerAssociations = ['OWNER', 'MEMBER', 'COLLABORATOR'];

// GitHub's own marker for an author who already has a commit merged into the repository
const returningAssociation = 'CONTRIBUTOR';
const ineligibleCacheMs = 30 * 60 * 1000;

function describe(login: string, mergedPrCount: number, required: number): ContributorEligibility {
	const eligible = mergedPrCount >= required;

	return {
		eligible,
		explanation: eligible
			? `@${login} has ${mergedPrCount} merged pull request(s) in this repository.`
			: `@${login} has ${mergedPrCount} merged pull request(s) in this repository; ` +
				`${required} needed before NS records are allowed.`
	};
}

// Eligible = a maintainer, or enough previously merged PRs in the repository
export async function getContributorEligibility(
	pullRequest: PullRequestSummary,
	options: {
		fresh: boolean;
		priority: boolean;
	}
): Promise<ContributorEligibility> {
	const { author, authorAssociation } = pullRequest;
	const required = getConfig().nsMinMergedPullRequests;

	if (maintainerAssociations.includes(authorAssociation)) {
		return {
			eligible: true,
			explanation: `@${author} is a repository ${authorAssociation.toLowerCase()}.`
		};
	}

	if (authorAssociation === returningAssociation) {
		return {
			eligible: true,
			explanation: `@${author} already has commits merged into this repository.`
		};
	}

	const cached = getContributor(author);

	if (cached && cached.mergedPrCount >= required) {
		// Merged PRs never un-merge, so an eligible result is safe to keep
		return describe(author, cached.mergedPrCount, required);
	}

	const cacheAgeMs = cached ? Date.now() - Date.parse(cached.checkedAt) : Infinity;

	if (cached && !options.fresh && cacheAgeMs < ineligibleCacheMs) {
		return describe(author, cached.mergedPrCount, required);
	}

	const mergedPrCount = await countMergedPullRequests(author, options.priority);

	saveContributor(author, mergedPrCount);

	return describe(author, mergedPrCount, required);
}
