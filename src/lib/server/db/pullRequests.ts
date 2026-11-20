/* src/lib/server/db/pullRequests.ts
 * MIT — (c) Doughmination System®
 */

import type { PullRequestRow, PullRequestSummary } from '../types.ts';
import { getDatabase, nowIso } from './database.ts';

export function getPullRequestRow(repo: string, number: number): PullRequestRow | null {
	return getDatabase()
		.query<PullRequestRow, [string, number]>(
			'SELECT * FROM pullRequests WHERE repo = ? AND number = ?'
		)
		.get(repo, number);
}

// Saves the latest PR details and leaves the scan markers untouched
export function upsertPullRequest(pullRequest: PullRequestSummary): void {
	getDatabase()
		.query<unknown, [Record<string, string | number>]>(
			`INSERT INTO pullRequests (
				repo,
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
				$repo,
				$number,
				$title,
				$author,
				$authorAssociation,
				$url,
				$state,
				$headSha,
				$updatedAt
			)
			ON CONFLICT (repo, number) DO UPDATE SET
				title = excluded.title,
				author = excluded.author,
				authorAssociation = excluded.authorAssociation,
				url = excluded.url,
				state = excluded.state,
				headSha = excluded.headSha,
				updatedAt = excluded.updatedAt`
		)
		.run({
			$repo: pullRequest.repo,
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

export function markPullRequestScanned(repo: string, number: number, scannedSha: string): void {
	getDatabase()
		.query('UPDATE pullRequests SET scannedSha = ?, scannedAt = ? WHERE repo = ? AND number = ?')
		.run(scannedSha, nowIso(), repo, number);
}

export function markPullRequestClosed(repo: string, number: number): void {
	getDatabase()
		.query(`UPDATE pullRequests SET state = 'closed' WHERE repo = ? AND number = ?`)
		.run(repo, number);
}
