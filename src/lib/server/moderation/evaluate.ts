/* src/lib/server/moderation/evaluate.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig } from '../config.ts';
import { getFileContent, listPullRequestFiles } from '../github/pullRequests.ts';
import { rules } from '../rules/index.ts';
import type { ContributorEligibility, DomainFile, Violation } from '../rules/types.ts';
import type { PullRequestSummary } from '../types.ts';
import { getContributorEligibility } from './eligibility.ts';

const registrationFile = /^domains\/[^/]+\.json$/;

export interface Evaluation {
	pullRequest: PullRequestSummary;
	files: DomainFile[];
	violations: Violation[];
	skippedFileCount: number;
}

function parseJson(content: string): unknown {
	try {
		return JSON.parse(content);
	} catch {
		return null;
	}
}

// Fetches the PR's registration files at its head commit and runs every rule over them
export async function evaluatePullRequest(
	pullRequest: PullRequestSummary,
	options: {
		fresh: boolean;
		priority: boolean;
	}
): Promise<Evaluation> {
	const changedFiles = await listPullRequestFiles(pullRequest.number, options.priority);

	const candidates = changedFiles.filter(
		(file) => registrationFile.test(file.filename) && file.status !== 'removed'
	);

	const inspected = candidates.slice(0, getConfig().maxFilesPerPullRequest);
	const files: DomainFile[] = [];

	for (const file of inspected) {
		const content = await getFileContent(file.filename, pullRequest.headSha, options.priority);

		if (content === null) {
			continue;
		}

		files.push({
			path: file.filename,
			status: file.status,
			patch: file.patch,
			content,
			json: parseJson(content)
		});
	}

	let eligibility: Promise<ContributorEligibility> | undefined;

	const getEligibility = () => {
		eligibility ??= getContributorEligibility(pullRequest, options);

		return eligibility;
	};

	const violations: Violation[] = [];

	for (const rule of rules) {
		violations.push(
			...(await rule.evaluate({
				pullRequest,
				files,
				getEligibility
			}))
		);
	}

	return {
		pullRequest,
		files,
		violations,
		skippedFileCount: candidates.length - inspected.length
	};
}
