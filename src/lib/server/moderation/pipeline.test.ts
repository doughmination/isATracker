/* src/lib/server/moderation/pipeline.test.ts
 * MIT — (c) Doughmination System®
 */

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

process.env.DATABASE_PATH = ':memory:';
process.env.GITHUB_TOKEN = 'test-token';
process.env.DRY_RUN = 'true';

import { getConfig } from '../config.ts';
import { getModerationStats, searchActions } from '../db/auditLog.ts';
import { listFindingsForPullRequest } from '../db/findings.ts';
import { performModerationAction } from './actions.ts';
import { scanOnce } from './scanner.ts';

interface FakePullRequest {
	number: number;
	author: string;
	association: string;
	sha: string;
	state: 'open' | 'closed';
	updatedAt: string;
	fileName: string;
	json: unknown;
}

interface RecordedWrite {
	method: string;
	path: string;
	body: {
		state?: string;
		event?: string;
		commit_id?: string;
		comments?: {
			path: string;
			line: number;
			body: string;
		}[];
	};
}

const nsJson = {
	owner: {
		username: 'newcomer',
		email: 'newcomer@example.com'
	},
	records: {
		NS: ['ns1.example.com', 'ns2.example.com']
	}
};

const noReplyJson = {
	owner: {
		username: 'hidden',
		email: '123+hidden@users.noreply.github.com'
	},
	records: {
		CNAME: 'hidden.github.io'
	}
};

const fakePullRequests = new Map<number, FakePullRequest>();
const writes: RecordedWrite[] = [];

function addPullRequest(pullRequest: FakePullRequest): void {
	fakePullRequests.set(pullRequest.number, pullRequest);
}

function toApi(pullRequest: FakePullRequest) {
	return {
		number: pullRequest.number,
		title: `Add ${pullRequest.fileName}`,
		html_url: `https://github.com/is-a-dev/register/pull/${pullRequest.number}`,
		state: pullRequest.state,
		updated_at: pullRequest.updatedAt,
		author_association: pullRequest.association,
		user: { login: pullRequest.author },
		head: { sha: pullRequest.sha }
	};
}

function fileText(pullRequest: FakePullRequest): string {
	return JSON.stringify(pullRequest.json, null, 2);
}

function jsonResponse(data: unknown): Response {
	return new Response(JSON.stringify(data), {
		headers: { 'content-type': 'application/json' }
	});
}

async function fakeGitHub(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const url = new URL(String(input));
	const method = init?.method ?? 'GET';
	const path = url.pathname.replace('/repos/is-a-dev/register', '');
	const numberMatch = /^\/(?:pulls|issues)\/(\d+)/.exec(path);
	const pullRequest = numberMatch ? fakePullRequests.get(Number(numberMatch[1])) : undefined;

	if (method !== 'GET') {
		writes.push({
			method,
			path,
			body: JSON.parse(String(init?.body))
		});

		if (method === 'PATCH' && pullRequest) {
			pullRequest.state = 'closed';
		}

		return jsonResponse({
			id: writes.length,
			html_url: `https://github.com/fake/${writes.length}`
		});
	}

	if (path === '/pulls') {
		const wanted = url.searchParams.get('state');

		const listed = [...fakePullRequests.values()]
			.filter((candidate) => wanted === 'all' || candidate.state === 'open')
			.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));

		return jsonResponse(listed.map(toApi));
	}

	if (path === '/search/issues' || url.pathname === '/search/issues') {
		return jsonResponse({ total_count: 0 });
	}

	if (url.pathname === '/user') {
		return jsonResponse({ login: 'moderator' });
	}

	if (path.startsWith('/contents/')) {
		const owner = [...fakePullRequests.values()].find(
			(candidate) => candidate.sha === url.searchParams.get('ref')
		);

		return new Response(owner ? fileText(owner) : 'missing', { status: owner ? 200 : 404 });
	}

	if (pullRequest && path.endsWith('/files')) {
		const addedLines = fileText(pullRequest)
			.split('\n')
			.map((line) => `+${line}`);

		return jsonResponse([
			{
				filename: pullRequest.fileName,
				status: 'added',
				patch: [`@@ -0,0 +1,${addedLines.length} @@`, ...addedLines].join('\n')
			}
		]);
	}

	if (pullRequest && path.endsWith('/reviews')) {
		return jsonResponse([]);
	}

	if (pullRequest) {
		return jsonResponse(toApi(pullRequest));
	}

	return new Response('{"message":"Not Found"}', { status: 404 });
}

function findingFor(prNumber: number) {
	return listFindingsForPullRequest(prNumber)[0];
}

before(() => {
	globalThis.fetch = fakeGitHub as typeof fetch;

	addPullRequest({
		number: 1,
		author: 'newcomer',
		association: 'NONE',
		sha: 'sha-one',
		state: 'open',
		updatedAt: '2026-11-01T00:00:01Z',
		fileName: 'domains/newcomer.json',
		json: nsJson
	});

	addPullRequest({
		number: 2,
		author: 'hidden',
		association: 'NONE',
		sha: 'sha-two',
		state: 'open',
		updatedAt: '2026-11-01T00:00:02Z',
		fileName: 'domains/hidden.json',
		json: noReplyJson
	});

	// A returning contributor may request NS records
	addPullRequest({
		number: 3,
		author: 'regular',
		association: 'CONTRIBUTOR',
		sha: 'sha-three',
		state: 'open',
		updatedAt: '2026-11-01T00:00:03Z',
		fileName: 'domains/regular.json',
		json: nsJson
	});

	addPullRequest({
		number: 4,
		author: 'fixer',
		association: 'NONE',
		sha: 'sha-four',
		state: 'open',
		updatedAt: '2026-11-01T00:00:04Z',
		fileName: 'domains/fixer.json',
		json: noReplyJson
	});
});

describe('moderation pipeline', () => {
	test('a scan creates one finding per real violation', async () => {
		await scanOnce();

		assert.equal(findingFor(1).ruleId, 'nsRecords');
		assert.equal(findingFor(2).ruleId, 'noReplyEmail');
		assert.equal(listFindingsForPullRequest(3).length, 0);
		assert.equal(findingFor(4).status, 'pending');
	});

	test('a repeat scan creates no duplicates', async () => {
		await scanOnce();

		assert.equal(listFindingsForPullRequest(1).length, 1);
		assert.equal(listFindingsForPullRequest(2).length, 1);
	});

	test('dry run writes nothing and leaves the finding pending', async () => {
		const outcome = await performModerationAction({
			findingId: findingFor(1).id,
			decision: 'approve',
			source: 'discord'
		});

		assert.equal(outcome.status, 'dryRun');
		assert.equal(writes.length, 0);
		assert.equal(findingFor(1).status, 'pending');
		assert.equal(getModerationStats().closedTotal, 0);
	});

	test('approving an NS finding comments once and closes once', async () => {
		getConfig().dryRun = false;

		const outcome = await performModerationAction({
			findingId: findingFor(1).id,
			decision: 'approve',
			source: 'discord'
		});

		assert.equal(outcome.status, 'success');
		assert.deepEqual(
			writes.map((write) => `${write.method} ${write.path}`),
			['POST /issues/1/comments', 'PATCH /pulls/1']
		);
		assert.deepEqual(writes[1].body, { state: 'closed' });
		assert.equal(findingFor(1).status, 'actioned');
	});

	test('a second approval of the same finding does nothing', async () => {
		const outcome = await performModerationAction({
			findingId: findingFor(1).id,
			decision: 'approve',
			source: 'dashboard'
		});

		assert.equal(outcome.status, 'skipped');
		assert.equal(writes.length, 2);
	});

	test('approving a no-reply finding requests changes inline on the email line', async () => {
		const outcome = await performModerationAction({
			findingId: findingFor(2).id,
			decision: 'approve',
			source: 'dashboard'
		});

		const review = writes[2];

		assert.equal(outcome.status, 'success');
		assert.equal(review.path, '/pulls/2/reviews');
		assert.equal(review.body.event, 'REQUEST_CHANGES');
		assert.equal(review.body.commit_id, 'sha-two');
		assert.equal(review.body.comments?.length, 1);

		const comment = review.body.comments![0];

		assert.equal(comment.path, 'domains/hidden.json');
		assert.equal(comment.line, 4);
		assert.ok(comment.body.includes('GitHub no-reply email address'));
		assert.equal(fakePullRequests.get(2)?.state, 'open');
	});

	test('a fix pushed by the contributor resolves the finding', async () => {
		const pullRequest = fakePullRequests.get(4)!;

		pullRequest.sha = 'sha-four-fixed';
		pullRequest.updatedAt = '2026-11-02T00:00:00Z';
		pullRequest.json = {
			owner: { username: 'fixer' },
			records: { CNAME: 'fixer.github.io' }
		};

		await scanOnce();

		assert.equal(findingFor(4).status, 'resolved');
	});

	test('a violation fixed after detection is caught by revalidation', async () => {
		addPullRequest({
			number: 5,
			author: 'racer',
			association: 'NONE',
			sha: 'sha-five',
			state: 'open',
			updatedAt: '2026-11-03T00:00:00Z',
			fileName: 'domains/racer.json',
			json: nsJson
		});

		await scanOnce();

		// The contributor removes the NS records before the button is pressed
		const pullRequest = fakePullRequests.get(5)!;

		pullRequest.sha = 'sha-five-fixed';
		pullRequest.json = {
			owner: { username: 'racer' },
			records: { A: ['1.2.3.4'] }
		};

		const writesBefore = writes.length;

		const outcome = await performModerationAction({
			findingId: findingFor(5).id,
			decision: 'approve',
			source: 'discord'
		});

		assert.equal(outcome.status, 'skipped');
		assert.equal(writes.length, writesBefore);
		assert.equal(findingFor(5).status, 'resolved');
	});

	test('statistics count successful actions only', () => {
		const stats = getModerationStats();

		assert.equal(stats.closedTotal, 1);
		assert.equal(stats.nsClosures, 1);
		assert.equal(stats.reviewsTotal, 1);
		// Dry run, closure, review and the revalidation skip; the claimed-twice attempt logs nothing
		assert.equal(searchActions('').length, 4);
		assert.equal(
			searchActions('newcomer').every((action) => action.prNumber === 1),
			true
		);
	});
});
