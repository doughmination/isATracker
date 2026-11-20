/* src/lib/server/github/pullRequests.ts
 * MIT — (c) Doughmination System®
 */

import { getRepoPath } from '../config.ts';
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
	body: string | null;
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

function toSummary(repo: string, pullRequest: ApiPullRequest): PullRequestSummary {
	return {
		repo,
		number: pullRequest.number,
		title: pullRequest.title,
		author: pullRequest.user?.login ?? 'ghost',
		authorAssociation: pullRequest.author_association,
		url: pullRequest.html_url,
		state: pullRequest.state,
		headSha: pullRequest.head.sha,
		updatedAt: pullRequest.updated_at,
		body: pullRequest.body ?? ''
	};
}

export interface PullRequestPage {
	pullRequests: PullRequestSummary[];
	etag: string | null;
	notModified: boolean;
}

export async function listPullRequests(options: {
	repo: string;
	state: 'open' | 'all';
	page: number;
	etag?: string | null;
}): Promise<PullRequestPage> {
	const response = await githubRequest<ApiPullRequest[]>({
		path: `${getRepoPath(options.repo)}/pulls`,
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
		pullRequests: response.notModified
			? []
			: response.data.map((pullRequest) => toSummary(options.repo, pullRequest)),
		etag: response.etag,
		notModified: response.notModified
	};
}

export async function getPullRequest(
	repo: string,
	number: number,
	priority = false
): Promise<PullRequestSummary> {
	const response = await githubRequest<ApiPullRequest>({
		path: `${getRepoPath(repo)}/pulls/${number}`,
		priority
	});

	return toSummary(repo, response.data);
}

export async function listPullRequestFiles(
	repo: string,
	number: number,
	priority = false
): Promise<PullRequestFile[]> {
	const files: PullRequestFile[] = [];

	// Three pages cover 300 files; a registration PR beyond that is not ours to judge
	for (let page = 1; page <= 3; page += 1) {
		const response = await githubRequest<PullRequestFile[]>({
			path: `${getRepoPath(repo)}/pulls/${number}/files`,
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
	repo: string,
	path: string,
	ref: string,
	priority = false
): Promise<string | null> {
	const encodedPath = path.split('/').map(encodeURIComponent).join('/');

	try {
		const response = await githubRequest<string>({
			path: `${getRepoPath(repo)}/contents/${encodedPath}`,
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

export async function countMergedPullRequests(
	repo: string,
	login: string,
	priority = false
): Promise<number> {
	const response = await githubRequest<{ total_count: number }>({
		path: '/search/issues',
		query: {
			q: `repo:${repo} is:pr is:merged author:${login}`,
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

export async function createIssueComment(
	repo: string,
	number: number,
	body: string
): Promise<CreatedComment> {
	const response = await githubRequest<CreatedComment>({
		method: 'POST',
		path: `${getRepoPath(repo)}/issues/${number}/comments`,
		body: { body },
		priority: true
	});

	return response.data;
}

export async function closePullRequest(repo: string, number: number): Promise<void> {
	await githubRequest({
		method: 'PATCH',
		path: `${getRepoPath(repo)}/pulls/${number}`,
		body: { state: 'closed' },
		priority: true
	});
}

export async function listReviews(repo: string, number: number): Promise<ApiReview[]> {
	const response = await githubRequest<ApiReview[]>({
		path: `${getRepoPath(repo)}/pulls/${number}/reviews`,
		query: { per_page: 100 },
		priority: true
	});

	return response.data;
}

export async function dismissReview(
	repo: string,
	number: number,
	reviewId: number,
	message: string
): Promise<void> {
	await githubRequest({
		method: 'PUT',
		path: `${getRepoPath(repo)}/pulls/${number}/reviews/${reviewId}/dismissals`,
		body: {
			message,
			event: 'DISMISS'
		},
		priority: true
	});
}

export async function createChangesRequestedReview(options: {
	repo: string;
	number: number;
	commitId: string;
	body: string;
	comments: ReviewComment[];
}): Promise<ApiReview> {
	const response = await githubRequest<ApiReview>({
		method: 'POST',
		path: `${getRepoPath(options.repo)}/pulls/${options.number}/reviews`,
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
