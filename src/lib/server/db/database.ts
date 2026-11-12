/* src/lib/server/db/database.ts
 * MIT — (c) Doughmination System®
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { getConfig } from '../config.ts';

const schema = `
CREATE TABLE IF NOT EXISTS pullRequests (
	number            INTEGER PRIMARY KEY,
	title             TEXT NOT NULL,
	author            TEXT NOT NULL,
	authorAssociation TEXT NOT NULL,
	url               TEXT NOT NULL,
	state             TEXT NOT NULL,
	headSha           TEXT NOT NULL,
	updatedAt         TEXT NOT NULL,
	scannedSha        TEXT,
	scannedAt         TEXT
);

CREATE TABLE IF NOT EXISTS findings (
	id               INTEGER PRIMARY KEY AUTOINCREMENT,
	prNumber         INTEGER NOT NULL REFERENCES pullRequests(number),
	ruleId           TEXT NOT NULL,
	filePath         TEXT NOT NULL,
	headSha          TEXT NOT NULL,
	reason           TEXT NOT NULL,
	status           TEXT NOT NULL,
	lastOutcome      TEXT,
	commentId        INTEGER,
	discordChannelId TEXT,
	discordMessageId TEXT,
	createdAt        TEXT NOT NULL,
	updatedAt        TEXT NOT NULL,
	UNIQUE (prNumber, ruleId, filePath)
);

CREATE INDEX IF NOT EXISTS findingsByStatus ON findings (status);

CREATE TABLE IF NOT EXISTS actions (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	findingId   INTEGER REFERENCES findings(id),
	prNumber    INTEGER NOT NULL,
	contributor TEXT NOT NULL,
	ruleId      TEXT NOT NULL,
	actionType  TEXT NOT NULL,
	source      TEXT NOT NULL,
	status      TEXT NOT NULL,
	detail      TEXT NOT NULL,
	githubUrl   TEXT,
	createdAt   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS actionsByCreatedAt ON actions (createdAt);

CREATE TABLE IF NOT EXISTS contributors (
	login         TEXT PRIMARY KEY,
	mergedPrCount INTEGER NOT NULL,
	checkedAt     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS keyValue (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
`;

type NamedParameters = Record<string, SQLInputValue>;

type QueryParameters = SQLInputValue[] | [NamedParameters];

export interface WriteResult {
	changes: number;
	lastInsertRowid: number;
}

// A typed statement: Row is what comes back, Parameters is what goes in
export interface Query<Row, Parameters extends QueryParameters> {
	get: (...parameters: Parameters) => Row | null;
	all: (...parameters: Parameters) => Row[];
	run: (...parameters: Parameters) => WriteResult;
}

export interface TrackerDatabase {
	exec: (sql: string) => void;
	query: <Row = unknown, Parameters extends QueryParameters = SQLInputValue[]>(
		sql: string
	) => Query<Row, Parameters>;
}

function wrapDatabase(connection: DatabaseSync): TrackerDatabase {
	return {
		exec: (sql) => connection.exec(sql),

		query<Row, Parameters extends QueryParameters>(sql: string): Query<Row, Parameters> {
			const statement = connection.prepare(sql);

			// node:sqlite takes named values first or positional values spread; both fit this call
			const spread = (parameters: QueryParameters) => parameters as SQLInputValue[];

			return {
				get: (...parameters) => (statement.get(...spread(parameters)) as Row | undefined) ?? null,
				all: (...parameters) => statement.all(...spread(parameters)) as Row[],
				run: (...parameters) => {
					const result = statement.run(...spread(parameters));

					return {
						changes: Number(result.changes),
						lastInsertRowid: Number(result.lastInsertRowid)
					};
				}
			};
		}
	};
}

let database: TrackerDatabase | undefined;

export function getDatabase(): TrackerDatabase {
	if (database) {
		return database;
	}

	const { databasePath } = getConfig();

	if (databasePath !== ':memory:') {
		mkdirSync(dirname(databasePath), { recursive: true });
	}

	database = wrapDatabase(new DatabaseSync(databasePath));
	database.exec('PRAGMA journal_mode = WAL;');
	database.exec('PRAGMA foreign_keys = ON;');
	database.exec(schema);

	// A crash mid-action leaves rows claimed; release them for a fresh, revalidated attempt
	database.exec(`UPDATE findings SET status = 'pending' WHERE status = 'acting';`);

	return database;
}

export function nowIso(): string {
	return new Date().toISOString();
}
