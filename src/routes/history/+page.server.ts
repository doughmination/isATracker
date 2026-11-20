/* src/routes/history/+page.server.ts
 * MIT — (c) Doughmination System®
 */

import { readRepoFilter } from '#lib/server/config.ts';
import { searchActions } from '#lib/server/db/auditLog.ts';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const searchText = url.searchParams.get('q') ?? '';
	const repoFilter = readRepoFilter(url);

	return {
		searchText,
		repoFilter,
		actions: searchActions(searchText, repoFilter)
	};
};
