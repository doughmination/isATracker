/* tests/access.test.mjs */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';

// Run against the production build without starting the scanner or Discord.
const directory = mkdtempSync(join(tmpdir(), 'tracker-access-'));
const password = process.env.ACCESS_TEST_PASSWORD ?? 'access-test-password';

process.env.DATABASE_PATH = join(directory, 'tracker.sqlite');
process.env.DASHBOARD_PASSWORD = password;
process.env.GITHUB_REPOS = 'is-a-dev/register,free-domains/is-a.bot';

const database = new DatabaseSync(process.env.DATABASE_PATH);
const privateError = 'Internal scanner error fixture';

database.exec('CREATE TABLE keyValue (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
database
	.prepare('INSERT INTO keyValue VALUES (?, ?)')
	.run('scanner.lastError:is-a-dev/register', privateError);
database.close();

after(() => rmSync(directory, { recursive: true }));

const { handle } = await import('../.svelte-kit/output/server/entries/hooks.server.js');
const { load: overview } =
	await import('../.svelte-kit/output/server/entries/pages/_page.server.ts.js');
const { actions: login } =
	await import('../.svelte-kit/output/server/entries/pages/login/_page.server.ts.js');

function eventFor(route, path = route, method = 'GET', token) {
	const url = new URL(path, 'https://tracker.example');

	return {
		url,
		request: new Request(url, { method }),
		route: { id: route },
		locals: {},
		cookies: { get: () => token }
	};
}

function resolve() {
	return new Response('resolved');
}

for (const route of ['/', '/history', '/lookup', '/login']) {
	test(`${route} is public, including page-data requests`, async () => {
		for (const path of [route, `${route === '/' ? '' : route}/__data.json`]) {
			const event = eventFor(route, path);
			const response = await handle({ event, resolve });

			assert.equal(response.status, 200);
			assert.equal(event.locals.authenticated, false);
		}
	});
}

test('Pending GET, page data, and direct action POSTs require login', async () => {
	for (const [path, method] of [
		['/pending', 'GET'],
		['/pending/__data.json', 'GET'],
		['/pending?/approve', 'POST'],
		['/pending?/ignore', 'POST']
	]) {
		const event = eventFor('/pending', path, method, 'invalid-session');

		if (password) {
			await assert.rejects(handle({ event, resolve }), (error) => {
				assert.equal(error.status, 303);
				assert.equal(error.location, '/login');
				return true;
			});
		} else {
			const response = await handle({ event, resolve });

			assert.equal(response.status, 503);
		}
	}
});

test('public overview data excludes raw scanner errors', () => {
	const data = overview(eventFor('/'));

	assert.equal(data.scanners[0].hasError, true);
	assert.equal(data.scanners[0].lastError, null);
	assert.equal(JSON.stringify(data).includes(privateError), false);
});

test(
	'login grants Pending access and logout returns to the public page',
	{
		skip: !password
	},
	async () => {
		let token;
		const event = eventFor('/login', '/login', 'POST');

		event.request = new Request(event.url, {
			method: 'POST',
			body: new URLSearchParams({ password })
		});
		event.cookies.set = (name, value) => {
			assert.equal(name, 'trackerSession');
			token = value;
		};

		await assert.rejects(login.default(event), (error) => error.location === '/pending');
		assert.ok(token);

		const pending = eventFor('/pending', '/pending', 'POST', token);
		const response = await handle({ event: pending, resolve });

		assert.equal(response.status, 200);
		assert.equal(pending.locals.authenticated, true);
		assert.equal(overview(pending).scanners[0].lastError, privateError);

		const { POST } =
			await import('../.svelte-kit/output/server/entries/endpoints/logout/_server.ts.js');

		assert.throws(
			() =>
				POST({
					cookies: {
						delete: (name) => assert.equal(name, 'trackerSession')
					}
				}),
			(error) => error.location === '/'
		);
	}
);
