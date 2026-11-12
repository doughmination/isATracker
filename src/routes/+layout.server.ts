/* src/routes/+layout.server.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig } from '#lib/server/config.ts';
import { listOpenFindings } from '#lib/server/db/findings.ts';
import { isPasswordConfigured } from '#lib/server/auth.ts';

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ url }) => {
	const onLoginPage = url.pathname === '/login';

	return {
		dryRun: getConfig().dryRun,
		pendingTotal: onLoginPage ? 0 : listOpenFindings().length,
		showNavigation: !onLoginPage,
		canSignOut: isPasswordConfigured()
	};
};
