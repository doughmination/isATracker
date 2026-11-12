/* src/lib/server/moderation/scanner.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig } from '../config.ts';
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
import { reconcileFindings, retireFindings } from './reconcile.ts';

const logger = createLogger('scanner');

const watermarkKey = 'scanner.watermark';
const etagKey = 'scanner.etag';
const lastScanKey = 'scanner.lastScanAt';
const lastErrorKey = 'scanner.lastError';
const maxPages = 15;

export interface ScannerStatus {
	lastScanAt: string | null;
	lastError: string | null;
}

export function getScannerStatus(): ScannerStatus {
	return {
		lastScanAt: getValue(lastScanKey),
		lastError: getValue(lastErrorKey)
	};
}

// First run: every open PR. Later runs: anything updated since the watermark, closed PRs included
async function collectUpdatedPullRequests(watermark: string | null): Promise<{
	pullRequests: PullRequestSummary[];
	etag: string | null;
} | null> {
	const collected: PullRequestSummary[] = [];
	let firstPageEtag: string | null = null;

	for (let page = 1; page <= maxPages; page += 1) {
		const result = await listPullRequests({
			state: watermark === null ? 'open' : 'all',
			page,
			etag: page === 1 && watermark !== null ? getValue(etagKey) : null
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
	const previous = getPullRequestRow(pullRequest.number);

	upsertPullRequest(pullRequest);

	if (pullRequest.state !== 'open') {
		retireFindings(pullRequest.number, 'The pull request was closed or merged.');
		return;
	}

	const alreadyScanned =
		previous !== null && previous.state === 'open' && previous.scannedSha === pullRequest.headSha;

	if (alreadyScanned) {
		return;
	}

	const evaluation = await evaluatePullRequest(pullRequest, {
		fresh: false,
		priority: false
	});

	reconcileFindings(pullRequest, evaluation.violations);
	markPullRequestScanned(pullRequest.number, pullRequest.headSha);

	if (evaluation.violations.length > 0) {
		logger.info(`#${pullRequest.number}: ${evaluation.violations.length} violation(s)`);
	}
}

export async function scanOnce(): Promise<void> {
	const watermark = getValue(watermarkKey);
	const updated = await collectUpdatedPullRequests(watermark);

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
				logger.error(`#${pullRequest.number} could not be evaluated; skipping`, error);
				newWatermark = pullRequest.updatedAt;
				continue;
			}

			if (newWatermark !== null) {
				setValue(watermarkKey, newWatermark);
			}

			// The list changed but was not fully handled, so the next poll must refetch it
			deleteValue(etagKey);

			throw error;
		}
	}

	if (newWatermark !== null) {
		setValue(watermarkKey, newWatermark);
	} else {
		setValue(watermarkKey, new Date().toISOString());
	}

	if (updated.etag) {
		setValue(etagKey, updated.etag);
	}
}

let timer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;

async function runCycle(afterScan: () => Promise<void>): Promise<void> {
	let delayMs = getConfig().pollIntervalSeconds * 1000;

	try {
		await scanOnce();
		setValue(lastScanKey, new Date().toISOString());
		deleteValue(lastErrorKey);
	} catch (error) {
		setValue(lastErrorKey, describeError(error));

		if (error instanceof RateLimitError) {
			delayMs = Math.max(delayMs, error.resumeAt - Date.now() + 5_000);
			logger.warn(`Paused for ${Math.round(delayMs / 1000)}s`, error);
		} else {
			logger.error('Scan failed; will retry next cycle', error);
		}
	}

	await afterScan().catch((error) => logger.warn('Post-scan step failed', error));

	if (!stopped) {
		timer = setTimeout(() => void runCycle(afterScan), delayMs);
	}
}

export function startScanner(afterScan: () => Promise<void>): void {
	stopped = false;
	logger.info(`Polling every ${getConfig().pollIntervalSeconds}s`);

	void runCycle(afterScan);
}

export function stopScanner(): void {
	stopped = true;
	clearTimeout(timer);
}
