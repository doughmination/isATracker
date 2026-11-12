/* src/lib/server/runtime.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig } from './config.ts';
import { getDatabase } from './db/database.ts';
import { flushNotifications, startDiscordBot, stopDiscordBot } from './discord/bot.ts';
import { removeFindingListeners } from './events.ts';
import { createLogger } from './logger.ts';
import { startScanner, stopScanner } from './moderation/scanner.ts';

const logger = createLogger('runtime');

interface RuntimeHandle {
	stop: () => Promise<void>;
}

// Kept on globalThis so a dev-server reload replaces the services instead of doubling them
const globalStore = globalThis as typeof globalThis & {
	trackerRuntime?: RuntimeHandle;
};

async function stop(): Promise<void> {
	stopScanner();
	removeFindingListeners();
	await stopDiscordBot();
}

export async function startServices(): Promise<void> {
	await globalStore.trackerRuntime?.stop();

	globalStore.trackerRuntime = { stop };

	const config = getConfig();

	getDatabase();

	logger.info(config.dryRun ? 'Dry run is ON: GitHub will not be changed' : 'Dry run is OFF');

	if (!config.githubToken) {
		logger.warn('GITHUB_TOKEN missing; reads are limited to 60 an hour and actions will fail');
	}

	await startDiscordBot().catch((error) => logger.error('Discord failed to start', error));

	if (config.scannerEnabled) {
		startScanner(flushNotifications);
	} else {
		logger.info('Scanner disabled (SCANNER_ENABLED=false)');
	}
}
