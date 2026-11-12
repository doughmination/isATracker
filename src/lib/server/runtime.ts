/* src/lib/server/runtime.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig } from './config.ts';
import { getDatabase } from './db/database.ts';
import { flushNotifications, startDiscordBot, stopDiscordBot } from './discord/bot.ts';
import { removeFindingListeners } from './events.ts';
import { checkToken } from './github/token.ts';
import { createLogger } from './logger.ts';
import { startScanner, stopScanner } from './moderation/scanner.ts';

const logger = createLogger('runtime');

interface RuntimeHandle {
	stop: () => Promise<void>;
}

// Kept on globalThis so a dev-server reload replaces the services instead of doubling them
const globalStore = globalThis as typeof globalThis & {
	trackerRuntime?: RuntimeHandle;
	trackerShutdownHooked?: boolean;
};

// The Node adapter closes the web server on SIGTERM or SIGINT, then emits this event.
// The Discord connection and the scanner timer would otherwise keep the process alive.
function hookShutdown(): void {
	if (globalStore.trackerShutdownHooked) {
		return;
	}

	globalStore.trackerShutdownHooked = true;

	process.on('sveltekit:shutdown', (reason: string) => {
		logger.info(`Stopping (${reason})`);

		void globalStore.trackerRuntime
			?.stop()
			.catch((error) => logger.warn('Clean stop failed', error))
			.finally(() => process.exit(0));
	});
}

async function stop(): Promise<void> {
	stopScanner();
	removeFindingListeners();
	await stopDiscordBot();
}

export async function startServices(): Promise<void> {
	await globalStore.trackerRuntime?.stop();

	globalStore.trackerRuntime = { stop };

	hookShutdown();

	const config = getConfig();

	getDatabase();

	logger.info(config.dryRun ? 'Dry run is ON: GitHub will not be changed' : 'Dry run is OFF');

	// Not awaited: a slow or failing GitHub must not delay the dashboard or the bot
	void checkToken();

	await startDiscordBot().catch((error) => logger.error('Discord failed to start', error));

	if (config.scannerEnabled) {
		startScanner(flushNotifications);
	} else {
		logger.info('Scanner disabled (SCANNER_ENABLED=false)');
	}
}
