/* src/lib/server/db/database.test.ts
 * MIT — (c) Doughmination System®
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';

import { legacyRepo, migrateToRepositories } from './database.ts';

// The single-repo schema as it was before the repo column
const legacySchema = `
CREATE TABLE pullRequests (
	number INTEGER PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL,
	authorAssociation TEXT NOT NULL, url TEXT NOT NULL, state TEXT NOT NULL,
	headSha TEXT NOT NULL, updatedAt TEXT NOT NULL, scannedSha TEXT, scannedAt TEXT
);
CREATE TABLE findings (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	prNumber INTEGER NOT NULL REFERENCES pullRequests(number),
	ruleId TEXT NOT NULL, filePath TEXT NOT NULL, headSha TEXT NOT NULL,
	reason TEXT NOT NULL, status TEXT NOT NULL, lastOutcome TEXT, commentId INTEGER,
	discordChannelId TEXT, discordMessageId TEXT, createdAt TEXT NOT NULL,
	updatedAt TEXT NOT NULL, UNIQUE (prNumber, ruleId, filePath)
);
CREATE INDEX findingsByStatus ON findings (status);
CREATE TABLE actions (
	id INTEGER PRIMARY KEY AUTOINCREMENT, findingId INTEGER REFERENCES findings(id),
	prNumber INTEGER NOT NULL, contributor TEXT NOT NULL, ruleId TEXT NOT NULL,
	actionType TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL,
	detail TEXT NOT NULL, githubUrl TEXT, createdAt TEXT NOT NULL
);
CREATE INDEX actionsByCreatedAt ON actions (createdAt);
CREATE TABLE contributors (
	login TEXT PRIMARY KEY, mergedPrCount INTEGER NOT NULL, checkedAt TEXT NOT NULL
);
CREATE TABLE keyValue (key TEXT PRIMARY KEY, value TEXT NOT NULL);

INSERT INTO pullRequests VALUES (7, 't', 'a', 'NONE', 'u', 'open', 's', 'd', NULL, NULL);
INSERT INTO findings VALUES (3, 7, 'nsRecords', 'f', 's', 'r', 'pending', NULL, NULL, NULL, NULL, 'c', 'c');
INSERT INTO actions VALUES (1, 3, 7, 'a', 'nsRecords', 'ignore', 'discord', 'success', 'd', NULL, 'c');
INSERT INTO contributors VALUES ('a', 2, 'c');
INSERT INTO keyValue VALUES ('scanner.watermark', 'w'), ('discordAvatarHash', 'h');
`;

describe('repository migration', () => {
	test('keeps every row, tags it with the legacy repo, and allows a second repo', () => {
		const connection = new DatabaseSync(':memory:');

		connection.exec(legacySchema);
		migrateToRepositories(connection);

		const finding = connection.prepare('SELECT id, repo, prNumber FROM findings').get();
		const action = connection.prepare('SELECT findingId, repo FROM actions').get();
		const contributor = connection.prepare('SELECT repo, login FROM contributors').get();
		const keys = connection.prepare('SELECT key FROM keyValue ORDER BY key').all();

		assert.deepEqual({ ...finding }, { id: 3, repo: legacyRepo, prNumber: 7 });
		assert.deepEqual({ ...action }, { findingId: 3, repo: legacyRepo });
		assert.deepEqual({ ...contributor }, { repo: legacyRepo, login: 'a' });
		assert.deepEqual(
			keys.map((row) => row.key),
			['discordAvatarHash', `scanner.watermark:${legacyRepo}`]
		);

		const indexes = connection
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%By%'`)
			.all();

		assert.equal(indexes.length, 2);

		// The same PR number in another repository no longer collides
		connection.exec(
			`INSERT INTO pullRequests (repo, number, title, author, authorAssociation, url, state, headSha, updatedAt)
			 VALUES ('free-domains/is-a.bot', 7, 't', 'a', 'NONE', 'u', 'open', 's', 'd')`
		);

		// A second run is a no-op
		migrateToRepositories(connection);

		assert.equal(connection.prepare('SELECT COUNT(*) AS total FROM pullRequests').get()?.total, 2);
	});
});
