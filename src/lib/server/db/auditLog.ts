/* src/lib/server/db/auditLog.ts
 * MIT — (c) Doughmination System®
 */

import type { ActionRow } from '../types.ts';
import { getDatabase, nowIso } from './database.ts';

export type NewAction = Omit<ActionRow, 'id' | 'createdAt'>;

export function recordAction(action: NewAction): void {
	getDatabase()
		.query(
			`INSERT INTO actions (
				findingId,
				prNumber,
				contributor,
				ruleId,
				actionType,
				source,
				status,
				detail,
				githubUrl,
				createdAt
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			action.findingId,
			action.prNumber,
			action.contributor,
			action.ruleId,
			action.actionType,
			action.source,
			action.status,
			action.detail,
			action.githubUrl,
			nowIso()
		);
}

export function searchActions(searchText: string, limit = 200): ActionRow[] {
	const pattern = `%${searchText.trim().replace(/^#/, '')}%`;

	return getDatabase()
		.query<ActionRow, [string, string, string, string, string, number]>(
			`SELECT * FROM actions
			 WHERE CAST(prNumber AS TEXT) LIKE ?
				OR contributor LIKE ?
				OR ruleId LIKE ?
				OR actionType LIKE ?
				OR status LIKE ?
			 ORDER BY id DESC
			 LIMIT ?`
		)
		.all(pattern, pattern, pattern, pattern, pattern, limit);
}

export interface DailyActionCount {
	day: string;
	closures: number;
	reviews: number;
}

export interface ModerationStats {
	closedTotal: number;
	nsClosures: number;
	reviewsTotal: number;
	pendingTotal: number;
	daily: DailyActionCount[];
}

function countWhere(table: 'actions' | 'findings', condition: string): number {
	const row = getDatabase()
		.query<{ total: number }, []>(`SELECT COUNT(*) AS total FROM ${table} WHERE ${condition}`)
		.get();

	return row?.total ?? 0;
}

// Only successful actions count towards statistics
export function getModerationStats(dayCount = 30): ModerationStats {
	const rows = getDatabase()
		.query<DailyActionCount, [string]>(
			`SELECT
				substr(createdAt, 1, 10) AS day,
				SUM(actionType = 'closePr') AS closures,
				SUM(actionType = 'requestChanges') AS reviews
			 FROM actions
			 WHERE status = 'success'
				AND actionType IN ('closePr', 'requestChanges')
				AND createdAt >= ?
			 GROUP BY day`
		)
		.all(new Date(Date.now() - dayCount * 86_400_000).toISOString());

	const countsByDay = new Map(rows.map((row) => [row.day, row]));
	const daily: DailyActionCount[] = [];

	for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
		const day = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
		const counts = countsByDay.get(day);

		daily.push({
			day,
			closures: counts?.closures ?? 0,
			reviews: counts?.reviews ?? 0
		});
	}

	return {
		closedTotal: countWhere('actions', `status = 'success' AND actionType = 'closePr'`),
		nsClosures: countWhere(
			'actions',
			`status = 'success' AND actionType = 'closePr' AND ruleId = 'nsRecords'`
		),
		reviewsTotal: countWhere('actions', `status = 'success' AND actionType = 'requestChanges'`),
		pendingTotal: countWhere('findings', `status IN ('pending', 'acting')`),
		daily
	};
}
