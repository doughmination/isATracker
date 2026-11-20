/* src/lib/server/db/contributors.ts
 * MIT — (c) Doughmination System®
 */

import { getDatabase, nowIso } from './database.ts';

export interface ContributorRow {
	repo: string;
	login: string;
	mergedPrCount: number;
	checkedAt: string;
}

// Merged PR counts are per repository
export function getContributor(repo: string, login: string): ContributorRow | null {
	return getDatabase()
		.query<ContributorRow, [string, string]>(
			'SELECT * FROM contributors WHERE repo = ? AND login = ?'
		)
		.get(repo, login.toLowerCase());
}

export function saveContributor(repo: string, login: string, mergedPrCount: number): void {
	getDatabase()
		.query(
			`INSERT INTO contributors (repo, login, mergedPrCount, checkedAt) VALUES (?, ?, ?, ?)
			 ON CONFLICT (repo, login) DO UPDATE SET
				mergedPrCount = excluded.mergedPrCount,
				checkedAt = excluded.checkedAt`
		)
		.run(repo, login.toLowerCase(), mergedPrCount, nowIso());
}
