/* src/lib/server/github/token.test.ts
 * MIT — (c) Doughmination System®
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { describeToken } from './token.ts';

describe('describeToken', () => {
	test('accepts a classic token with public_repo', () => {
		const report = describeToken({
			login: 'clove',
			scopes: ['public_repo'],
			canTriage: true
		});

		assert.equal(report.level, 'info');
		assert.equal(report.lines.length, 1);
	});

	test('rejects a classic token without a write scope', () => {
		const report = describeToken({
			login: 'clove',
			scopes: ['read:user'],
			canTriage: true
		});

		assert.equal(report.level, 'error');
		assert.ok(report.lines[0].includes('public_repo'));
	});

	test('rejects a classic token with no scopes at all', () => {
		const report = describeToken({
			login: 'clove',
			scopes: [],
			canTriage: true
		});

		assert.equal(report.level, 'error');
	});

	test('notes that the repo scope is broader than needed', () => {
		const report = describeToken({
			login: 'clove',
			scopes: ['repo'],
			canTriage: true
		});

		assert.equal(report.level, 'info');
		assert.equal(report.lines.length, 2);
	});

	test('warns when the account cannot close pull requests', () => {
		const report = describeToken({
			login: 'clove',
			scopes: ['public_repo'],
			canTriage: false
		});

		assert.equal(report.level, 'warn');
	});

	test('a fine-grained token has no scope list to judge', () => {
		const report = describeToken({
			login: 'clove',
			scopes: null,
			canTriage: true
		});

		assert.equal(report.level, 'info');
	});
});
