/* src/lib/server/rules/rules.test.ts
 * MIT — (c) Doughmination System®
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { getCommentableLines } from '../github/diff.ts';
import { findNoReplyEmail, findOwnerEmailLine } from './noReplyEmail.ts';
import { findNsRecords } from './nsRecords.ts';
import { findCnameLine, findUnsupportedCname } from './unsupportedCname.ts';
import { findVercelLinks, redirectsToVercelLogin } from './vercelLogin.ts';

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

describe('findUnsupportedCname', () => {
	const unsupported = ['vercel.app', 'pages.dev'];

	test('matches a listed host and its subdomains, ignoring case and a trailing dot', () => {
		assert.equal(
			findUnsupportedCname({ records: { CNAME: 'vercel.app' } }, unsupported),
			'vercel.app'
		);
		assert.equal(
			findUnsupportedCname({ record: { cname: 'Me.Pages.Dev.' } }, unsupported),
			'Me.Pages.Dev.'
		);
	});

	test('ignores supported hosts, look-alikes and missing CNAMEs', () => {
		assert.equal(findUnsupportedCname({ records: { CNAME: 'me.github.io' } }, unsupported), null);
		assert.equal(findUnsupportedCname({ records: { CNAME: 'notvercel.app' } }, unsupported), null);
		assert.equal(findUnsupportedCname({ records: { A: ['1.2.3.4'] } }, unsupported), null);
		assert.equal(findUnsupportedCname({ records: { CNAME: 'vercel.app' } }, []), null);
	});

	test('list entries written as ".tld" match that whole TLD', () => {
		const tlds = ['.tk', '.blob.core.windows.net', '*.workers.dev'];

		assert.equal(findUnsupportedCname({ records: { CNAME: 'site.tk' } }, tlds), 'site.tk');
		assert.equal(
			findUnsupportedCname({ records: { CNAME: 'a.blob.core.windows.net' } }, tlds),
			'a.blob.core.windows.net'
		);
		assert.equal(
			findUnsupportedCname({ records: { CNAME: 'me.workers.dev' } }, tlds),
			'me.workers.dev'
		);
		assert.equal(findUnsupportedCname({ records: { CNAME: 'site.tkx' } }, tlds), null);
	});

	test('finds the CNAME line', () => {
		assert.equal(findCnameLine('{\n  "records": {\n    "CNAME": "x.vercel.app"\n  }\n}'), 3);
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

describe('findVercelLinks', () => {
	const template = [
		'<!-- This should be a LINK (e.g. https://abc.vercel.app, https://abc.github.io) -->',
		'',
		'<!-- WEBSITE_PREVIEW_START -->',
		'https://my-site.vercel.app/',
		'<!-- WEBSITE_PREVIEW_END -->',
		'',
		'Also see https://other.vercel.app'
	].join('\n');

	test('reads only the preview section, ignoring the example in comments', () => {
		assert.deepEqual(findVercelLinks(template), ['https://my-site.vercel.app/']);
	});

	test('falls back to the whole body when the markers are gone', () => {
		assert.deepEqual(findVercelLinks('Preview: https://a.vercel.app and https://b.github.io'), [
			'https://a.vercel.app'
		]);
	});
});

describe('redirectsToVercelLogin', () => {
	const realFetch = globalThis.fetch;

	function fakeRedirects(locations: Record<string, string>): string[] {
		const requested: string[] = [];

		globalThis.fetch = (async (input: string | URL | Request) => {
			const url = String(input);
			const location = locations[url];

			requested.push(url);

			return new Response(null, {
				status: location ? 302 : 200,
				headers: location ? { location } : {}
			});
		}) as typeof fetch;

		return requested;
	}

	test('follows the Vercel Authentication chain to the login page', async () => {
		fakeRedirects({
			'https://locked.vercel.app/': 'https://vercel.com/sso-api?url=x',
			'https://vercel.com/sso-api?url=x': '/login?next=%2Fsso-api'
		});

		assert.equal(await redirectsToVercelLogin('https://locked.vercel.app/'), true);
		globalThis.fetch = realFetch;
	});

	test('a public preview is not flagged', async () => {
		fakeRedirects({});

		assert.equal(await redirectsToVercelLogin('https://open.vercel.app/'), false);
		globalThis.fetch = realFetch;
	});

	test('never follows a redirect off Vercel', async () => {
		const requested = fakeRedirects({
			'https://sneaky.vercel.app/': 'http://127.0.0.1:3101/login'
		});

		assert.equal(await redirectsToVercelLogin('https://sneaky.vercel.app/'), false);
		assert.deepEqual(requested, ['https://sneaky.vercel.app/']);
		globalThis.fetch = realFetch;
	});
});
