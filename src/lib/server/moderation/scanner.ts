/* src/lib/server/moderation/scanner.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig } from '../config.ts';
import { listFindingsForPullRequest } from '../db/findings.ts';
import { deleteValue, getValue, setValue } from '../db/keyValue.ts';
import {
	getPullRequestRow,
	markPullRequestScanned,
	upsertPullRequest
} from '../db/pullRequests.ts';
import { RateLimitError } from '../github/client.ts';
import { listPullRequests } from '../github/pullRequests.ts';
import { createLogger, describeError } from '../logger.ts';
import type { PullRequestSummary } from '../types.ts';
import { evaluatePullRequest } from './evaluate.ts';
import { dismissFixedChangeRequests } from './executors.ts';
import { reconcileFindings, retireFindings } from './reconcile.ts';

const logger = createLogger('scanner');

// Scanner state is kept per repository
const watermarkKey = (repo: string) => `scanner.watermark:${repo}`;
const etagKey = (repo: string) => `scanner.etag:${repo}`;
const lastScanKey = (repo: string) => `scanner.lastScanAt:${repo}`;
const lastErrorKey = (repo: string) => `scanner.lastError:${repo}`;
const maxPages = 15;

export interface ScannerStatus {
	repo: string;
	lastScanAt: string | null;
	lastError: string | null;
}

export function getScannerStatus(repo: string): ScannerStatus {
	return {
		repo,
		lastScanAt: getValue(lastScanKey(repo)),
		lastError: getValue(lastErrorKey(repo))
	};
}

// First run: every open PR. Later runs: anything updated since the watermark, closed PRs included
async function collectUpdatedPullRequests(
	repo: string,
	watermark: string | null
): Promise<{
	pullRequests: PullRequestSummary[];
	etag: string | null;
} | null> {
	const collected: PullRequestSummary[] = [];
	let firstPageEtag: string | null = null;

	for (let page = 1; page <= maxPages; page += 1) {
		const result = await listPullRequests({
			repo,
			state: watermark === null ? 'open' : 'all',
			page,
			etag: page === 1 && watermark !== null ? getValue(etagKey(repo)) : null
		});

		if (result.notModified) {
			return null;
		}

		if (page === 1) {
			firstPageEtag = result.etag;
		}

		const fresh = result.pullRequests.filter(
			(pullRequest) => watermark === null || pullRequest.updatedAt >= watermark
		);

		collected.push(...fresh);

		const reachedOldPullRequests = fresh.length < result.pullRequests.length;

		if (reachedOldPullRequests || result.pullRequests.length < 100) {
			break;
		}
	}

	return {
		pullRequests: collected,
		etag: firstPageEtag
	};
}

async function processPullRequest(pullRequest: PullRequestSummary): Promise<void> {
	const { repo, number } = pullRequest;
	const previous = getPullRequestRow(repo, number);

	upsertPullRequest(pullRequest);

	if (pullRequest.state !== 'open') {
		retireFindings(repo, number, 'The pull request was closed or merged.');
		return;
	}

	const alreadyScanned =
		previous !== null && previous.state === 'open' && previous.scannedSha === pullRequest.headSha;

	// A fix can land without a commit (an edited description, a Vercel setting), so flagged PRs are rechecked on any update
	const hasOpenFindings = listFindingsForPullRequest(repo, number).some(
		(finding) => finding.status === 'pending' || finding.status === 'actioned'
	);

	if (alreadyScanned && !hasOpenFindings) {
		return;
	}

	const evaluation = await evaluatePullRequest(pullRequest, {
		fresh: false,
		priority: false
	});

	await dismissFixedChangeRequests(pullRequest, evaluation.violations);
	reconcileFindings(pullRequest, evaluation.violations);
	markPullRequestScanned(repo, number, pullRequest.headSha);

	if (evaluation.violations.length > 0) {
		logger.info(`${repo}#${number}: ${evaluation.violations.length} violation(s)`);
	}
}

export async function scanOnce(repo: string): Promise<void> {
	const watermark = getValue(watermarkKey(repo));
	const updated = await collectUpdatedPullRequests(repo, watermark);

	if (updated === null) {
		return;
	}

	// Oldest first, so the watermark can stop just before the first failure
	const ordered = updated.pullRequests.sort((first, second) =>
		first.updatedAt.localeCompare(second.updatedAt)
	);

	let newWatermark = watermark;

	for (const pullRequest of ordered) {
		try {
			await processPullRequest(pullRequest);
			newWatermark = pullRequest.updatedAt;
		} catch (error) {
			if (!(error instanceof RateLimitError)) {
				// One broken PR must not stall the queue; it is rechecked when it next changes
				logger.error(`${repo}#${pullRequest.number} could not be evaluated; skipping`, error);
				newWatermark = pullRequest.updatedAt;
				continue;
			}

			if (newWatermark !== null) {
				setValue(watermarkKey(repo), newWatermark);
			}

			// The list changed but was not fully handled, so the next poll must refetch it
			deleteValue(etagKey(repo));

			throw error;
		}
	}

	if (newWatermark !== null) {
		setValue(watermarkKey(repo), newWatermark);
	} else {
		setValue(watermarkKey(repo), new Date().toISOString());
	}

	if (updated.etag) {
		setValue(etagKey(repo), updated.etag);
	}
}

let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;

async function runCycle(afterScan: () => Promise<void>): Promise<void> {
	let delayMs = getConfig().pollIntervalSeconds * 1000;

	for (const repo of getConfig().repos) {
		try {
			await scanOnce(repo);
			setValue(lastScanKey(repo), new Date().toISOString());
			deleteValue(lastErrorKey(repo));
		} catch (error) {
			setValue(lastErrorKey(repo), describeError(error));

			if (error instanceof RateLimitError) {
				// The read token serves every repository, so the rest would hit the same limit
				delayMs = Math.max(delayMs, error.resumeAt - Date.now() + 5_000);
				logger.warn(`Paused for ${Math.round(delayMs / 1000)}s`, error);
				break;
			}

			logger.error(`Scan of ${repo} failed; will retry next cycle`, error);
		}
	}

	await afterScan().catch((error) => logger.warn('Post-scan step failed', error));

	if (!stopped) {
		timer = setTimeout(() => void runCycle(afterScan), delayMs);
	}
}

export function startScanner(afterScan: () => Promise<void>): void {
	stopped = false;
	logger.info(`Polling ${getConfig().repos.join(', ')} every ${getConfig().pollIntervalSeconds}s`);

	void runCycle(afterScan);
}

export function stopScanner(): void {
	stopped = true;
	clearTimeout(timer);
}
