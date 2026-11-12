/* src/routes/+page.server.ts
 * MIT — (c) Doughmination System®
 */

import { getModerationStats } from '#lib/server/db/auditLog.ts';
import { getScannerStatus } from '#lib/server/moderation/scanner.ts';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	return {
		stats: getModerationStats(30),
		scanner: getScannerStatus()
	};
};
