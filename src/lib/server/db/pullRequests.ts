/* src/lib/server/db/pullRequests.ts
 * MIT — (c) Doughmination System®
 */

import type { PullRequestRow, PullRequestSummary } from '../types.ts';
import { getDatabase, nowIso } from './database.ts';

export function getPullRequestRow(number: number): PullRequestRow | null {
	return getDatabase()
		.query<PullRequestRow, [number]>('SELECT * FROM pullRequests WHERE number = ?')
		.get(number);
}

// Saves the latest PR details and leaves the scan markers untouched
export function upsertPullRequest(pullRequest: PullRequestSummary): void {
	getDatabase()
		.query<unknown, [Record<string, string | number>]>(
			`INSERT INTO pullRequests (
				number,
				title,
				author,
				authorAssociation,
				url,
				state,
				headSha,
				updatedAt
			)
			VALUES (
				$number,
				$title,
				$author,
				$authorAssociation,
				$url,
				$state,
				$headSha,
				$updatedAt
			)
			ON CONFLICT (number) DO UPDATE SET
				title = excluded.title,
				author = excluded.author,
				authorAssociation = excluded.authorAssociation,
				url = excluded.url,
				state = excluded.state,
				headSha = excluded.headSha,
				updatedAt = excluded.updatedAt`
		)
		.run({
			$number: pullRequest.number,
			$title: pullRequest.title,
			$author: pullRequest.author,
			$authorAssociation: pullRequest.authorAssociation,
			$url: pullRequest.url,
			$state: pullRequest.state,
			$headSha: pullRequest.headSha,
			$updatedAt: pullRequest.updatedAt
		});
}

export function markPullRequestScanned(number: number, scannedSha: string): void {
	getDatabase()
		.query('UPDATE pullRequests SET scannedSha = ?, scannedAt = ? WHERE number = ?')
		.run(scannedSha, nowIso(), number);
}

export function markPullRequestClosed(number: number): void {
	getDatabase().query(`UPDATE pullRequests SET state = 'closed' WHERE number = ?`).run(number);
}
