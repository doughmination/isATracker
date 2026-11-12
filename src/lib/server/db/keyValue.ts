/* src/lib/server/db/keyValue.ts
 * MIT — (c) Doughmination System®
 */

import { getDatabase } from './database.ts';

export function getValue(key: string): string | null {
	const row = getDatabase()
		.query<{ value: string }, [string]>('SELECT value FROM keyValue WHERE key = ?')
		.get(key);

	return row?.value ?? null;
}

export function setValue(key: string, value: string): void {
	getDatabase()
		.query(
			`INSERT INTO keyValue (key, value) VALUES (?, ?)
			 ON CONFLICT (key) DO UPDATE SET value = excluded.value`
		)
		.run(key, value);
}

export function deleteValue(key: string): void {
	getDatabase().query('DELETE FROM keyValue WHERE key = ?').run(key);
}
