/* src/routes/+layout.server.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig, readRepoFilter } from '#lib/server/config.ts';
import { listOpenFindings } from '#lib/server/db/findings.ts';
import { isPasswordConfigured } from '#lib/server/auth.ts';

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ url }) => {
	const onLoginPage = url.pathname === '/login';
	const repoFilter = readRepoFilter(url);

	return {
		dryRun: getConfig().dryRun,
		repos: getConfig().repos,
		repoFilter,
		pendingTotal: onLoginPage ? 0 : listOpenFindings().length,
		showNavigation: !onLoginPage,
		canSignOut: isPasswordConfigured()
	};
};
