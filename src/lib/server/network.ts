/* src/lib/server/network.ts
 * MIT — (c) Doughmination System®
 */

import { createLogger, describeError, sleep } from './logger.ts';

const logger = createLogger('network');

// The two services the tracker cannot work without; neither probe needs a token
const probeUrls = ['https://api.github.com/', 'https://discord.com/api/v10/gateway'];

const probeTimeoutMs = 8_000;

// Staggered waits between attempts; the last one repeats until the network answers
const defaultDelaysSeconds = [2, 5, 10, 20, 40, 60];

// Any HTTP answer at all proves the host is reachable; only a thrown error means it is not
async function probeAll(): Promise<void> {
	for (const url of probeUrls) {
		const response = await fetch(url, {
			method: 'HEAD',
			signal: AbortSignal.timeout(probeTimeoutMs)
		});

		await response.body?.cancel();
	}
}

export interface WaitForNetworkOptions {
	isCancelled: () => boolean;
	probe?: () => Promise<void>;
	delaysSeconds?: number[];
}

// Resolves true once the network answers, or false if cancelled while waiting
export async function waitForNetwork(options: WaitForNetworkOptions): Promise<boolean> {
	const probe = options.probe ?? probeAll;
	const delaysSeconds = options.delaysSeconds ?? defaultDelaysSeconds;

	for (let attempt = 0; !options.isCancelled(); attempt += 1) {
		try {
			await probe();

			if (attempt > 0) {
				logger.info(`Network is up after ${attempt + 1} attempts`);
			}

			return !options.isCancelled();
		} catch (error) {
			const delaySeconds = delaysSeconds[Math.min(attempt, delaysSeconds.length - 1)];

			logger.warn(`Network not ready (${describeError(error)}); trying again in ${delaySeconds}s`);

			await sleep(delaySeconds * 1000);
		}
	}

	return false;
}
