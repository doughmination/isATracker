/* src/lib/server/github/pullRequests.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig, getRepoPath } from '../config.ts';
import type { PullRequestSummary } from '../types.ts';
import { GitHubError, githubRequest } from './client.ts';

// Shapes below mirror GitHub's REST payloads, so they keep GitHub's field names
interface ApiPullRequest {
	number: number;
	title: string;
	html_url: string;
	state: 'open' | 'closed';
	updated_at: string;
	author_association: string;
	user: { login: string } | null;
	head: { sha: string };
}

export interface PullRequestFile {
	filename: string;
	status: string;
	patch?: string;
}

export interface ApiReview {
	id: number;
	state: string;
	body: string | null;
	commit_id: string;
	html_url: string;
	user: { login: string } | null;
}

export interface ReviewComment {
	path: string;
	line: number;
	side: 'RIGHT';
	body: string;
}

function toSummary(pullRequest: ApiPullRequest): PullRequestSummary {
	return {
		number: pullRequest.number,
		title: pullRequest.title,
		author: pullRequest.user?.login ?? 'ghost',
		authorAssociation: pullRequest.author_association,
		url: pullRequest.html_url,
		state: pullRequest.state,
		headSha: pullRequest.head.sha,
		updatedAt: pullRequest.updated_at
	};
}

export interface PullRequestPage {
	pullRequests: PullRequestSummary[];
	etag: string | null;
	notModified: boolean;
}

export async function listPullRequests(options: {
	state: 'open' | 'all';
	page: number;
	etag?: string | null;
}): Promise<PullRequestPage> {
	const response = await githubRequest<ApiPullRequest[]>({
		path: `${getRepoPath()}/pulls`,
		query: {
			state: options.state,
			sort: 'updated',
			direction: 'desc',
			per_page: 100,
			page: options.page
		},
		etag: options.etag
	});

	return {
		pullRequests: response.notModified ? [] : response.data.map(toSummary),
		etag: response.etag,
		notModified: response.notModified
	};
}

export async function getPullRequest(
	number: number,
	priority = false
): Promise<PullRequestSummary> {
	const response = await githubRequest<ApiPullRequest>({
		path: `${getRepoPath()}/pulls/${number}`,
		priority
	});

	return toSummary(response.data);
}

export async function listPullRequestFiles(
	number: number,
	priority = false
): Promise<PullRequestFile[]> {
	const files: PullRequestFile[] = [];

	// Three pages cover 300 files; a registration PR beyond that is not ours to judge
	for (let page = 1; page <= 3; page += 1) {
		const response = await githubRequest<PullRequestFile[]>({
			path: `${getRepoPath()}/pulls/${number}/files`,
			query: {
				per_page: 100,
				page
			},
			priority
		});

		files.push(...response.data);

		if (response.data.length < 100) {
			break;
		}
	}

	return files;
}

// Fork commits are readable through the base repository by their SHA
export async function getFileContent(
	path: string,
	ref: string,
	priority = false
): Promise<string | null> {
	const encodedPath = path.split('/').map(encodeURIComponent).join('/');

	try {
		const response = await githubRequest<string>({
			path: `${getRepoPath()}/contents/${encodedPath}`,
			query: { ref },
			accept: 'application/vnd.github.raw+json',
			priority
		});

		return response.data;
	} catch (error) {
		if (error instanceof GitHubError && error.status === 404) {
			return null;
		}

		throw error;
	}
}

export async function countMergedPullRequests(login: string, priority = false): Promise<number> {
	const { repoOwner, repoName } = getConfig();

	const response = await githubRequest<{ total_count: number }>({
		path: '/search/issues',
		query: {
			q: `repo:${repoOwner}/${repoName} is:pr is:merged author:${login}`,
			per_page: 1
		},
		priority
	});

	return response.data.total_count;
}

let authenticatedLogin: string | undefined;

export async function getAuthenticatedLogin(): Promise<string> {
	if (!authenticatedLogin) {
		const response = await githubRequest<{ login: string }>({
			path: '/user',
			priority: true
		});

		authenticatedLogin = response.data.login;
	}

	return authenticatedLogin;
}

export interface CreatedComment {
	id: number;
	html_url: string;
}

export async function createIssueComment(number: number, body: string): Promise<CreatedComment> {
	const response = await githubRequest<CreatedComment>({
		method: 'POST',
		path: `${getRepoPath()}/issues/${number}/comments`,
		body: { body },
		priority: true
	});

	return response.data;
}

export async function closePullRequest(number: number): Promise<void> {
	await githubRequest({
		method: 'PATCH',
		path: `${getRepoPath()}/pulls/${number}`,
		body: { state: 'closed' },
		priority: true
	});
}

export async function listReviews(number: number): Promise<ApiReview[]> {
	const response = await githubRequest<ApiReview[]>({
		path: `${getRepoPath()}/pulls/${number}/reviews`,
		query: { per_page: 100 },
		priority: true
	});

	return response.data;
}

export async function createChangesRequestedReview(options: {
	number: number;
	commitId: string;
	body: string;
	comments: ReviewComment[];
}): Promise<ApiReview> {
	const response = await githubRequest<ApiReview>({
		method: 'POST',
		path: `${getRepoPath()}/pulls/${options.number}/reviews`,
		body: {
			commit_id: options.commitId,
			event: 'REQUEST_CHANGES',
			body: options.body,
			comments: options.comments
		},
		priority: true
	});

	return response.data;
}
