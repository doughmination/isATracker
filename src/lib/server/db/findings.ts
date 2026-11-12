/* src/lib/server/db/findings.ts
 * MIT — (c) Doughmination System®
 */

import type { FindingRow, FindingStatus, FindingWithPullRequest, RuleId } from '../types.ts';
import { getDatabase, nowIso } from './database.ts';

const joinedSelect = `
	SELECT
		findings.*,
		pullRequests.title,
		pullRequests.author,
		pullRequests.url
	FROM findings
	JOIN pullRequests ON pullRequests.number = findings.prNumber
`;

export function getFinding(id: number): FindingWithPullRequest | null {
	return getDatabase()
		.query<FindingWithPullRequest, [number]>(`${joinedSelect} WHERE findings.id = ?`)
		.get(id);
}

export function listFindingsForPullRequest(prNumber: number): FindingRow[] {
	return getDatabase()
		.query<FindingRow, [number]>('SELECT * FROM findings WHERE prNumber = ?')
		.all(prNumber);
}

export function listOpenFindings(): FindingWithPullRequest[] {
	return getDatabase()
		.query<FindingWithPullRequest, []>(
			`${joinedSelect}
			 WHERE findings.status IN ('pending', 'acting')
			 ORDER BY findings.createdAt DESC`
		)
		.all();
}

// Pending findings that never reached Discord, oldest first
export function listUnnotifiedFindings(): FindingWithPullRequest[] {
	return getDatabase()
		.query<FindingWithPullRequest, []>(
			`${joinedSelect}
			 WHERE findings.status = 'pending' AND findings.discordMessageId IS NULL
			 ORDER BY findings.createdAt ASC`
		)
		.all();
}

export interface NewFinding {
	prNumber: number;
	ruleId: RuleId;
	filePath: string;
	headSha: string;
	reason: string;
}

export function insertFinding(finding: NewFinding): number {
	const timestamp = nowIso();

	const result = getDatabase()
		.query(
			`INSERT INTO findings (
				prNumber,
				ruleId,
				filePath,
				headSha,
				reason,
				status,
				createdAt,
				updatedAt
			)
			VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
		)
		.run(
			finding.prNumber,
			finding.ruleId,
			finding.filePath,
			finding.headSha,
			finding.reason,
			timestamp,
			timestamp
		);

	return Number(result.lastInsertRowid);
}

export function updateFindingEvidence(id: number, headSha: string, reason: string): void {
	getDatabase()
		.query('UPDATE findings SET headSha = ?, reason = ?, updatedAt = ? WHERE id = ?')
		.run(headSha, reason, nowIso(), id);
}

export function setFindingStatus(id: number, status: FindingStatus, lastOutcome?: string): void {
	getDatabase()
		.query(
			`UPDATE findings
			 SET status = ?, lastOutcome = COALESCE(?, lastOutcome), updatedAt = ?
			 WHERE id = ?`
		)
		.run(status, lastOutcome ?? null, nowIso(), id);
}

// Reopens a finding and forgets its old Discord message, so a fresh notification goes out
export function reopenFinding(id: number, headSha: string, reason: string): void {
	getDatabase()
		.query(
			`UPDATE findings
			 SET status = 'pending',
				 headSha = ?,
				 reason = ?,
				 lastOutcome = NULL,
				 commentId = NULL,
				 discordChannelId = NULL,
				 discordMessageId = NULL,
				 updatedAt = ?
			 WHERE id = ?`
		)
		.run(headSha, reason, nowIso(), id);
}

// Atomic claim: only one caller can move a finding from pending to acting
export function claimFinding(id: number): boolean {
	const result = getDatabase()
		.query(
			`UPDATE findings SET status = 'acting', updatedAt = ? WHERE id = ? AND status = 'pending'`
		)
		.run(nowIso(), id);

	return result.changes === 1;
}

export function setFindingComment(id: number, commentId: number): void {
	getDatabase().query('UPDATE findings SET commentId = ? WHERE id = ?').run(commentId, id);
}

export function setFindingDiscordMessage(id: number, channelId: string, messageId: string): void {
	getDatabase()
		.query('UPDATE findings SET discordChannelId = ?, discordMessageId = ? WHERE id = ?')
		.run(channelId, messageId, id);
}
