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
				repo,
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
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			action.findingId,
			action.repo,
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

// repo null = every repository
export function searchActions(
	searchText: string,
	repo: string | null = null,
	limit = 200
): ActionRow[] {
	const pattern = `%${searchText.trim().replace(/^#/, '')}%`;

	return getDatabase()
		.query<
			ActionRow,
			[string | null, string | null, string, string, string, string, string, number]
		>(
			`SELECT * FROM actions
			 WHERE (? IS NULL OR repo = ?)
				AND (
					CAST(prNumber AS TEXT) LIKE ?
					OR contributor LIKE ?
					OR ruleId LIKE ?
					OR actionType LIKE ?
					OR status LIKE ?
				)
			 ORDER BY id DESC
			 LIMIT ?`
		)
		.all(repo, repo, pattern, pattern, pattern, pattern, pattern, limit);
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

function countWhere(table: 'actions' | 'findings', condition: string, repo: string | null): number {
	const row = getDatabase()
		.query<{ total: number }, [string | null, string | null]>(
			`SELECT COUNT(*) AS total FROM ${table}
			 WHERE (? IS NULL OR repo = ?) AND ${condition}`
		)
		.get(repo, repo);

	return row?.total ?? 0;
}

// Only successful actions count towards statistics; repo null = every repository
export function getModerationStats(dayCount = 30, repo: string | null = null): ModerationStats {
	const rows = getDatabase()
		.query<DailyActionCount, [string | null, string | null, string]>(
			`SELECT
				substr(createdAt, 1, 10) AS day,
				SUM(actionType = 'closePr') AS closures,
				SUM(actionType = 'requestChanges') AS reviews
			 FROM actions
			 WHERE (? IS NULL OR repo = ?)
				AND status = 'success'
				AND actionType IN ('closePr', 'requestChanges')
				AND createdAt >= ?
			 GROUP BY day`
		)
		.all(repo, repo, new Date(Date.now() - dayCount * 86_400_000).toISOString());

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
		closedTotal: countWhere('actions', `status = 'success' AND actionType = 'closePr'`, repo),
		nsClosures: countWhere(
			'actions',
			`status = 'success' AND actionType = 'closePr' AND ruleId = 'nsRecords'`,
			repo
		),
		reviewsTotal: countWhere(
			'actions',
			`status = 'success' AND actionType = 'requestChanges'`,
			repo
		),
		pendingTotal: countWhere('findings', `status IN ('pending', 'acting')`, repo),
		daily
	};
}
