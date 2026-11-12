/* src/routes/lookup/+page.server.ts
 * MIT — (c) Doughmination System®
 */

import { getPullRequest } from '#lib/server/github/pullRequests.ts';
import { describeError } from '#lib/server/logger.ts';
import { evaluatePullRequest } from '#lib/server/moderation/evaluate.ts';

import type { PageServerLoad } from './$types';

// Accepts "123", "#123" or any GitHub pull request URL
function parsePullRequestNumber(input: string): number | null {
	const match = /\/pull\/(\d+)/.exec(input) ?? /^#?(\d+)$/.exec(input.trim());

	return match ? Number(match[1]) : null;
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

	const number = parsePullRequestNumber(query);

	if (number === null) {
		return {
			query,
			result: null,
			problem: 'Enter a PR number or a GitHub pull request URL.'
		};
	}

	try {
		const pullRequest = await getPullRequest(number, true);

		const evaluation = await evaluatePullRequest(pullRequest, {
			fresh: true,
			priority: true
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
			problem: `Could not check #${number}: ${describeError(error)}`
		};
	}
};
