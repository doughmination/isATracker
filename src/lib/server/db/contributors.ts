/* src/lib/server/db/contributors.ts
 * MIT — (c) Doughmination System®
 */

import { getDatabase, nowIso } from './database.ts';

export interface ContributorRow {
	login: string;
	mergedPrCount: number;
	checkedAt: string;
}

export function getContributor(login: string): ContributorRow | null {
	return getDatabase()
		.query<ContributorRow, [string]>('SELECT * FROM contributors WHERE login = ?')
		.get(login.toLowerCase());
}

export function saveContributor(login: string, mergedPrCount: number): void {
	getDatabase()
		.query(
			`INSERT INTO contributors (login, mergedPrCount, checkedAt) VALUES (?, ?, ?)
			 ON CONFLICT (login) DO UPDATE SET
				mergedPrCount = excluded.mergedPrCount,
				checkedAt = excluded.checkedAt`
		)
		.run(login.toLowerCase(), mergedPrCount, nowIso());
}
