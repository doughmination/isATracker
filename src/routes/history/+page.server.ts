/* src/routes/history/+page.server.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig } from '#lib/server/config.ts';
import { searchActions } from '#lib/server/db/auditLog.ts';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const searchText = url.searchParams.get('q') ?? '';
	const { repoOwner, repoName } = getConfig();

	return {
		searchText,
		repoUrl: `https://github.com/${repoOwner}/${repoName}`,
		actions: searchActions(searchText)
	};
};
