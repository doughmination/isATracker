/* src/lib/server/rules/rules.test.ts
 * MIT — (c) Doughmination System®
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { getCommentableLines } from '../github/diff.ts';
import { findNoReplyEmail, findOwnerEmailLine } from './noReplyEmail.ts';
import { findNsRecords } from './nsRecords.ts';

describe('findNsRecords', () => {
	test('finds NS records under "records"', () => {
		const json = {
			records: {
				NS: ['ns1.example.com', 'ns2.example.com']
			}
		};

		assert.deepEqual(findNsRecords(json), ['ns1.example.com', 'ns2.example.com']);
	});

	test('finds NS records under the older "record" key', () => {
		const json = {
			record: {
				ns: ['ns1.example.com']
			}
		};

		assert.deepEqual(findNsRecords(json), ['ns1.example.com']);
	});

	test('ignores ordinary record types', () => {
		const json = {
			records: {
				A: ['1.2.3.4'],
				CNAME: 'example.com',
				TXT: 'ns1.example.com'
			}
		};

		assert.deepEqual(findNsRecords(json), []);
	});

	test('ignores an empty NS list and broken JSON', () => {
		assert.deepEqual(findNsRecords({ records: { NS: [] } }), []);
		assert.deepEqual(findNsRecords(null), []);
		assert.deepEqual(findNsRecords('NS'), []);
	});
});

describe('findNoReplyEmail', () => {
	test('matches both no-reply forms', () => {
		const plain = { owner: { email: 'username@users.noreply.github.com' } };
		const numbered = { owner: { email: '12345678+username@users.noreply.github.com' } };

		assert.equal(findNoReplyEmail(plain), 'username@users.noreply.github.com');
		assert.equal(findNoReplyEmail(numbered), '12345678+username@users.noreply.github.com');
	});

	test('ignores personal addresses, missing emails and look-alike domains', () => {
		assert.equal(findNoReplyEmail({ owner: { email: 'clove@example.com' } }), null);
		assert.equal(findNoReplyEmail({ owner: { username: 'clove' } }), null);
		assert.equal(
			findNoReplyEmail({ owner: { email: 'a@users.noreply.github.com.evil.io' } }),
			null
		);
	});

	test('only reads owner.email, not other fields', () => {
		const json = {
			owner: { username: 'clove' },
			description: 'mail me at clove@users.noreply.github.com'
		};

		assert.equal(findNoReplyEmail(json), null);
	});
});

describe('review line placement', () => {
	const content = [
		'{',
		'  "owner": {',
		'    "username": "clove",',
		'    "email": "clove@users.noreply.github.com"',
		'  },',
		'  "records": {}',
		'}'
	].join('\n');

	test('finds the owner.email line', () => {
		assert.equal(findOwnerEmailLine(content, 'clove@users.noreply.github.com'), 4);
	});

	test('a new file makes every line commentable', () => {
		const patch = '@@ -0,0 +1,3 @@\n+{\n+  "a": 1\n+}\n\\ No newline at end of file';

		assert.deepEqual([...getCommentableLines(patch)], [1, 2, 3]);
	});

	test('a modified file exposes context and added lines only', () => {
		const patch = '@@ -10,3 +10,3 @@\n context\n-removed\n+added\n context';

		assert.deepEqual([...getCommentableLines(patch)], [10, 11, 12]);
		assert.equal(getCommentableLines(undefined).size, 0);
	});
});
