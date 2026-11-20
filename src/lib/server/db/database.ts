/* src/lib/server/db/database.ts
 * MIT — (c) Doughmination System®
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { getConfig } from '../config.ts';

const schema = `
CREATE TABLE IF NOT EXISTS pullRequests (
	repo              TEXT NOT NULL,
	number            INTEGER NOT NULL,
	title             TEXT NOT NULL,
	author            TEXT NOT NULL,
	authorAssociation TEXT NOT NULL,
	url               TEXT NOT NULL,
	state             TEXT NOT NULL,
	headSha           TEXT NOT NULL,
	updatedAt         TEXT NOT NULL,
	scannedSha        TEXT,
	scannedAt         TEXT,
	PRIMARY KEY (repo, number)
);

CREATE TABLE IF NOT EXISTS findings (
	id               INTEGER PRIMARY KEY AUTOINCREMENT,
	repo             TEXT NOT NULL,
	prNumber         INTEGER NOT NULL,
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
	FOREIGN KEY (repo, prNumber) REFERENCES pullRequests (repo, number),
	UNIQUE (repo, prNumber, ruleId, filePath)
);

CREATE INDEX IF NOT EXISTS findingsByStatus ON findings (status);

CREATE TABLE IF NOT EXISTS actions (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	findingId   INTEGER REFERENCES findings(id),
	repo        TEXT NOT NULL,
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
	repo          TEXT NOT NULL,
	login         TEXT NOT NULL,
	mergedPrCount INTEGER NOT NULL,
	checkedAt     TEXT NOT NULL,
	PRIMARY KEY (repo, login)
);

CREATE TABLE IF NOT EXISTS keyValue (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
`;

// Before multi-repo support, every row belonged to this repository
export const legacyRepo = 'is-a-dev/register';

const repoTables = ['pullRequests', 'findings', 'actions', 'contributors'];

// Rebuilds the single-repo tables with a repo column; runs once, inside one transaction
export function migrateToRepositories(connection: DatabaseSync): void {
	const columns = connection.prepare('PRAGMA table_info(pullRequests)').all() as {
		name: string;
	}[];

	const isLegacy = columns.length > 0 && !columns.some((column) => column.name === 'repo');

	if (!isLegacy) {
		return;
	}

	// Foreign keys cannot be switched inside a transaction, and would block the rebuild
	connection.exec('PRAGMA foreign_keys = OFF;');
	connection.exec('BEGIN;');

	try {
		for (const table of repoTables) {
			connection.exec(`ALTER TABLE ${table} RENAME TO ${table}Legacy;`);
		}

		// Old index names would make the schema's CREATE INDEX IF NOT EXISTS a no-op
		connection.exec('DROP INDEX IF EXISTS findingsByStatus;');
		connection.exec('DROP INDEX IF EXISTS actionsByCreatedAt;');
		connection.exec(schema);

		for (const table of repoTables) {
			const legacyColumns = (
				connection.prepare(`PRAGMA table_info(${table}Legacy)`).all() as { name: string }[]
			)
				.map((column) => column.name)
				.join(', ');

			connection
				.prepare(
					`INSERT INTO ${table} (repo, ${legacyColumns})
					 SELECT ?, ${legacyColumns} FROM ${table}Legacy`
				)
				.run(legacyRepo);

			connection.exec(`DROP TABLE ${table}Legacy;`);
		}

		// Scanner state is now kept per repository
		connection
			.prepare(`UPDATE keyValue SET key = key || ':' || ? WHERE key LIKE 'scanner.%'`)
			.run(legacyRepo);

		connection.exec('COMMIT;');
	} catch (error) {
		connection.exec('ROLLBACK;');
		throw error;
	}
}

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

	const connection = new DatabaseSync(databasePath);

	connection.exec('PRAGMA journal_mode = WAL;');
	migrateToRepositories(connection);

	database = wrapDatabase(connection);
	database.exec('PRAGMA foreign_keys = ON;');
	database.exec(schema);

	// A crash mid-action leaves rows claimed; release them for a fresh, revalidated attempt
	database.exec(`UPDATE findings SET status = 'pending' WHERE status = 'acting';`);

	return database;
}

export function nowIso(): string {
	return new Date().toISOString();
}
