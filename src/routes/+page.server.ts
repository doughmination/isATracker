/* src/routes/+page.server.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig, readRepoFilter } from '#lib/server/config.ts';
import { getModerationStats } from '#lib/server/db/auditLog.ts';
import { getScannerStatus } from '#lib/server/moderation/scanner.ts';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, locals }) => {
	const repoFilter = readRepoFilter(url);
	const repos = repoFilter ? [repoFilter] : getConfig().repos;

	return {
		stats: getModerationStats(30, repoFilter),
		scanners: repos.map((repo) => {
			const scanner = getScannerStatus(repo);

			return {
				repo: scanner.repo,
				lastScanAt: scanner.lastScanAt,
				lastError: locals.authenticated ? scanner.lastError : null,
				hasError: scanner.lastError !== null
			};
		})
	};
};
