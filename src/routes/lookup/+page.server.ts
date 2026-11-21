/* src/routes/lookup/+page.server.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig, readRepoFilter } from '#lib/server/config.ts';
import { getPullRequest } from '#lib/server/github/pullRequests.ts';
import { describeError } from '#lib/server/logger.ts';
import { evaluatePullRequest } from '#lib/server/moderation/evaluate.ts';

import type { PageServerLoad } from './$types';

// Accepts "123", "#123" or a GitHub pull request URL; a bare number uses the fallback repo
function parsePullRequest(
	input: string,
	fallbackRepo: string
): { repo: string; number: number } | null {
	const urlMatch = /github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/.exec(input);

	if (urlMatch) {
		return {
			repo: urlMatch[1],
			number: Number(urlMatch[2])
		};
	}

	const numberMatch = /^#?(\d+)$/.exec(input.trim());

	return numberMatch
		? {
				repo: fallbackRepo,
				number: Number(numberMatch[1])
			}
		: null;
}

// Read-only: fetches and validates live, and stores nothing
export const load: PageServerLoad = async ({ url }) => {
	const query = url.searchParams.get('pr') ?? '';

	if (query.trim() === '') {
		return {
			query,
			result: null,
			problem: null
		};
	}

	const { repos } = getConfig();
	const parsed = parsePullRequest(query, readRepoFilter(url) ?? repos[0]);

	if (parsed === null) {
		return {
			query,
			result: null,
			problem: 'Enter a PR number or a GitHub pull request URL.'
		};
	}

	const { repo, number } = parsed;

	// Only the tracked repositories, so the lookup cannot be pointed anywhere else
	if (!repos.includes(repo)) {
		return {
			query,
			result: null,
			problem: `${repo} is not a tracked repository (${repos.join(', ')}).`
		};
	}

	try {
		const pullRequest = await getPullRequest(repo, number);

		const evaluation = await evaluatePullRequest(pullRequest, {
			fresh: true,
			priority: false
		});

		return {
			query,
			problem: null,
			result: {
				pullRequest,
				violations: evaluation.violations,
				inspectedFiles: evaluation.files.map((file) => ({
					path: file.path,
					validJson: file.json !== null
				})),
				skippedFileCount: evaluation.skippedFileCount
			}
		};
	} catch (error) {
		return {
			query,
			result: null,
			problem: `Could not check ${repo}#${number}: ${describeError(error)}`
		};
	}
};
