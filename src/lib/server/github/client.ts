/* src/lib/server/github/client.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig } from '../config.ts';
import { createLogger, sleep } from '../logger.ts';

const logger = createLogger('github');

const apiBase = 'https://api.github.com';
const requestTimeoutMs = 20_000;
const retryDelaysMs = [1_000, 3_000];

export class GitHubError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'GitHubError';
	}
}

export class RateLimitError extends Error {
	constructor(readonly resumeAt: number) {
		super(`GitHub rate limit reached; resumes at ${new Date(resumeAt).toISOString()}`);
		this.name = 'RateLimitError';
	}
}

interface RateBucket {
	limit: number;
	remaining: number;
	resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

let blockedUntil = 0;

export interface GitHubRequest {
	method?: 'GET' | 'POST' | 'PATCH';
	path: string;
	query?: Record<string, string | number>;
	body?: unknown;
	accept?: string;
	etag?: string | null;
	// Moderator-approved actions may spend the reserve kept back from the scanner
	priority?: boolean;
}

export interface GitHubResponse<Data> {
	status: number;
	data: Data;
	etag: string | null;
	notModified: boolean;
	// Scopes of a classic token; null when GitHub sends none (fine-grained or no token)
	scopes: string[] | null;
}

function readScopes(headers: Headers): string[] | null {
	const header = headers.get('x-oauth-scopes');

	if (header === null) {
		return null;
	}

	return header
		.split(',')
		.map((scope) => scope.trim())
		.filter((scope) => scope !== '');
}

function assertWithinRateLimit(resource: string, priority: boolean): void {
	const now = Date.now();

	if (now < blockedUntil) {
		throw new RateLimitError(blockedUntil);
	}

	const bucket = rateBuckets.get(resource);

	if (!bucket || now >= bucket.resetAt) {
		return;
	}

	const scannerReserve = Math.min(getConfig().rateLimitReserve, Math.floor(bucket.limit * 0.1));
	const floor = priority ? 0 : scannerReserve;

	if (bucket.remaining <= floor) {
		throw new RateLimitError(bucket.resetAt);
	}
}

function recordRateLimit(headers: Headers, fallbackResource: string): void {
	const remaining = headers.get('x-ratelimit-remaining');
	const reset = headers.get('x-ratelimit-reset');

	if (remaining === null || reset === null) {
		return;
	}

	rateBuckets.set(headers.get('x-ratelimit-resource') ?? fallbackResource, {
		limit: Number(headers.get('x-ratelimit-limit') ?? 0),
		remaining: Number(remaining),
		resetAt: Number(reset) * 1000
	});
}

function buildUrl(request: GitHubRequest): string {
	const url = new URL(apiBase + request.path);

	for (const [name, value] of Object.entries(request.query ?? {})) {
		url.searchParams.set(name, String(value));
	}

	return url.toString();
}

function buildHeaders(request: GitHubRequest): Headers {
	const headers = new Headers({
		Accept: request.accept ?? 'application/vnd.github+json',
		'User-Agent': 'is-a-tracker',
		'X-GitHub-Api-Version': '2022-11-28'
	});

	const { githubToken } = getConfig();

	if (githubToken) {
		headers.set('Authorization', `Bearer ${githubToken}`);
	}

	if (request.etag) {
		headers.set('If-None-Match', request.etag);
	}

	if (request.body !== undefined) {
		headers.set('Content-Type', 'application/json');
	}

	return headers;
}

async function readErrorMessage(response: Response): Promise<string> {
	const text = await response.text().catch(() => '');

	try {
		const parsed = JSON.parse(text) as { message?: string };

		return parsed.message ?? text;
	} catch {
		return text;
	}
}

async function sendOnce<Data>(request: GitHubRequest): Promise<GitHubResponse<Data>> {
	const resource = request.path.startsWith('/search') ? 'search' : 'core';

	assertWithinRateLimit(resource, request.priority ?? false);

	const response = await fetch(buildUrl(request), {
		method: request.method ?? 'GET',
		headers: buildHeaders(request),
		body: request.body === undefined ? undefined : JSON.stringify(request.body),
		signal: AbortSignal.timeout(requestTimeoutMs)
	});

	recordRateLimit(response.headers, resource);

	const etag = response.headers.get('etag');

	if (response.status === 304) {
		return {
			status: 304,
			data: undefined as Data,
			etag,
			notModified: true,
			scopes: readScopes(response.headers)
		};
	}

	const retryAfter = Number(response.headers.get('retry-after') ?? 0);
	const exhausted = response.headers.get('x-ratelimit-remaining') === '0';

	if ((response.status === 403 || response.status === 429) && (retryAfter > 0 || exhausted)) {
		const resetAt = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000;
		const resumeAt = retryAfter > 0 ? Date.now() + retryAfter * 1000 : resetAt;

		blockedUntil = Math.max(blockedUntil, resumeAt);

		throw new RateLimitError(resumeAt);
	}

	if (response.status === 403 && response.headers.has('x-github-sso')) {
		throw new GitHubError(
			403,
			'The organisation uses single sign-on: authorise this token for it under "Configure SSO" in your GitHub token settings.'
		);
	}

	if (!response.ok) {
		throw new GitHubError(response.status, await readErrorMessage(response));
	}

	const isJson = (response.headers.get('content-type') ?? '').includes('json');
	const wantsRaw = (request.accept ?? '').includes('raw');
	const data = isJson && !wantsRaw ? await response.json() : await response.text();

	return {
		status: response.status,
		data: data as Data,
		etag,
		notModified: false,
		scopes: readScopes(response.headers)
	};
}

function isRetryable(error: unknown): boolean {
	if (error instanceof RateLimitError) {
		return false;
	}

	if (error instanceof GitHubError) {
		return error.status >= 500;
	}

	// Network failures and timeouts
	return true;
}

export async function githubRequest<Data>(request: GitHubRequest): Promise<GitHubResponse<Data>> {
	// Writes are never retried automatically, so nothing is ever posted twice
	const isRead = (request.method ?? 'GET') === 'GET';
	const attempts = isRead ? retryDelaysMs.length + 1 : 1;

	for (let attempt = 1; ; attempt += 1) {
		try {
			return await sendOnce<Data>(request);
		} catch (error) {
			if (attempt >= attempts || !isRetryable(error)) {
				throw error;
			}

			logger.warn(`${request.path} failed, retrying`, error);

			await sleep(retryDelaysMs[attempt - 1]);
		}
	}
}

export function getRateLimitSnapshot(): Record<string, RateBucket> {
	return Object.fromEntries(rateBuckets);
}
