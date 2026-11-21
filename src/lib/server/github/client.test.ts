/* src/lib/server/github/client.test.ts */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { getConfig } from '../config.ts';
import { GitHubError, RateLimitError, getRateLimitSnapshot, githubRequest } from './client.ts';
import {
	closePullRequest,
	createChangesRequestedReview,
	createIssueComment,
	dismissReview,
	getAuthenticatedLogin,
	getPullRequest,
	listPullRequests,
	listReviews
} from './pullRequests.ts';

const originalFetch = globalThis.fetch;
const config = getConfig();
let sequence = 0;
let calls: { path: string; method: string; authorization: string | null }[];

function responseWithQuota(remaining: number, resource = 'core'): Response {
	return Response.json(
		{},
		{
			headers: {
				'x-ratelimit-limit': '5000',
				'x-ratelimit-remaining': String(remaining),
				'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
				'x-ratelimit-resource': resource
			}
		}
	);
}

describe('GitHub credentials and quotas', () => {
	beforeEach(() => {
		sequence += 1;
		config.readGithubToken = `reader-fixture-${sequence}`;
		config.maintainerGithubToken = `maintainer-fixture-${sequence}`;
		calls = [];

		globalThis.fetch = async (input, options) => {
			calls.push({
				path: new URL(String(input)).pathname,
				method: options?.method ?? 'GET',
				authorization: new Headers(options?.headers).get('Authorization')
			});

			return responseWithQuota(4999);
		};
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test('ordinary reads use the reader, while action safety checks use the maintainer', async () => {
		await githubRequest({ path: '/repos/example/repo/pulls' });
		await githubRequest({
			path: '/repos/example/repo/pulls/1',
			priority: true
		});

		assert.deepEqual(
			calls.map((call) => call.authorization),
			[`Bearer ${config.readGithubToken}`, `Bearer ${config.maintainerGithubToken}`]
		);
	});

	test('every write uses the maintainer even without the priority flag', async () => {
		for (const method of ['POST', 'PATCH', 'PUT'] as const) {
			await githubRequest({
				method,
				path: '/repos/example/repo/pulls/1'
			});
		}

		assert.ok(
			calls.every((call) => call.authorization === `Bearer ${config.maintainerGithubToken}`)
		);
	});

	test('an exhausted reader neither blocks actions nor falls back to the maintainer', async () => {
		globalThis.fetch = async () => responseWithQuota(0);
		await githubRequest({ path: '/repos/example/repo/pulls' });
		await assert.rejects(githubRequest({ path: '/repos/example/repo/pulls' }), RateLimitError);
		await githubRequest({
			method: 'PATCH',
			path: '/repos/example/repo/pulls/1'
		});

		const snapshot = getRateLimitSnapshot();

		assert.equal(snapshot.read.core.remaining, 0);
		assert.equal(snapshot.maintainer.core.remaining, 0);
		assert.equal(JSON.stringify(snapshot).includes(config.readGithubToken), false);
	});

	test('the reader can use its own budget below the old shared-token reserve', async () => {
		globalThis.fetch = async () => responseWithQuota(1);
		await githubRequest({ path: '/repos/example/repo/pulls' });
		await githubRequest({ path: '/repos/example/repo/pulls' });
	});

	test('one shared credential retains the moderation reserve', async () => {
		config.readGithubToken = config.maintainerGithubToken;
		globalThis.fetch = async () => responseWithQuota(100);
		await githubRequest({ path: '/repos/example/repo/pulls' });
		await assert.rejects(githubRequest({ path: '/repos/example/repo/pulls' }), RateLimitError);
		await githubRequest({
			path: '/repos/example/repo/pulls/1',
			priority: true
		});
	});

	test('exhausted search quota does not block core reads', async () => {
		globalThis.fetch = async () => responseWithQuota(0, 'search');
		await githubRequest({ path: '/search/issues' });
		await assert.rejects(githubRequest({ path: '/search/issues' }), RateLimitError);
		await githubRequest({ path: '/repos/example/repo/pulls' });
	});

	test('secondary throttles without headers back off without retrying or switching tokens', async () => {
		let fetchCount = 0;

		globalThis.fetch = async () => {
			fetchCount += 1;
			return Response.json(
				{ message: 'You have exceeded a secondary rate limit.' },
				{ status: 403 }
			);
		};

		const startedAt = Date.now();

		await assert.rejects(githubRequest({ path: '/repos/example/repo/pulls' }), (error) => {
			assert.ok(error instanceof RateLimitError);
			assert.ok(error.resumeAt >= startedAt + 60_000);
			return true;
		});
		await assert.rejects(githubRequest({ path: '/search/issues' }), RateLimitError);
		assert.equal(fetchCount, 1);

		globalThis.fetch = async () => responseWithQuota(4999);
		await githubRequest({
			method: 'PATCH',
			path: '/repos/example/repo/pulls/1'
		});
	});

	test('Retry-After applies to the selected credential', async () => {
		globalThis.fetch = async () =>
			Response.json(
				{},
				{
					status: 429,
					headers: { 'retry-after': '120' }
				}
			);

		const startedAt = Date.now();

		await assert.rejects(githubRequest({ path: '/repos/example/repo/pulls' }), (error) => {
			assert.ok(error instanceof RateLimitError);
			assert.ok(error.resumeAt >= startedAt + 120_000);
			return true;
		});
	});

	test('read-only configuration cannot send a write using the alt token', async () => {
		config.maintainerGithubToken = '';

		await assert.rejects(
			githubRequest({
				method: 'POST',
				path: '/repos/example/repo/issues/1/comments'
			}),
			GitHubError
		);
		assert.equal(calls.length, 0);
	});

	test('writes are never retried after a server error', async () => {
		let fetchCount = 0;

		globalThis.fetch = async () => {
			fetchCount += 1;
			return Response.json({ message: 'unavailable' }, { status: 503 });
		};

		await assert.rejects(
			githubRequest({
				method: 'POST',
				path: '/repos/example/repo/issues/1/comments'
			}),
			GitHubError
		);
		assert.equal(fetchCount, 1);
	});

	test('the maintainer identity and moderation helpers use the maintainer credential', async () => {
		globalThis.fetch = async (input, options) => {
			assert.equal(
				new Headers(options?.headers).get('Authorization'),
				`Bearer ${config.maintainerGithubToken}`
			);

			return Response.json({ login: 'maintainer-fixture' });
		};

		assert.equal(await getAuthenticatedLogin(), 'maintainer-fixture');
		await createIssueComment('example/repo', 1, 'comment');
		await closePullRequest('example/repo', 1);
		await listReviews('example/repo', 1);
		await dismissReview('example/repo', 1, 2, 'fixed');
		await createChangesRequestedReview({
			repo: 'example/repo',
			number: 1,
			commitId: 'fixture-sha',
			body: 'review',
			comments: []
		});
	});

	test('scanner and lookup pull request helpers use the read credential', async () => {
		globalThis.fetch = async (input, options) => {
			assert.equal(
				new Headers(options?.headers).get('Authorization'),
				`Bearer ${config.readGithubToken}`
			);

			const pullRequest = {
				number: 1,
				title: 'Fixture',
				head: { sha: 'fixture-sha' }
			};

			return Response.json(
				new URL(String(input)).pathname.endsWith('/pulls') ? [pullRequest] : pullRequest
			);
		};

		await listPullRequests({
			repo: 'example/repo',
			state: 'open',
			page: 1
		});
		await getPullRequest('example/repo', 1);
	});
});
