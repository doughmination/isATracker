/* src/lib/server/runtime.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig } from './config.ts';
import { getDatabase } from './db/database.ts';
import { flushNotifications, startDiscordBot, stopDiscordBot } from './discord/bot.ts';
import { removeFindingListeners } from './events.ts';
import { checkToken } from './github/token.ts';
import { createLogger } from './logger.ts';
import { waitForNetwork } from './network.ts';
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
	startGeneration += 1;

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

	startGeneration += 1;

	// Not awaited: the dashboard opens at once, even while the network is still down
	void startNetworkServices(startGeneration);
}

// Each start gets a new number, so a stop or restart ends any older wait
let startGeneration = 0;

// Everything that talks to GitHub or Discord waits here until the network answers
async function startNetworkServices(generation: number): Promise<void> {
	const ready = await waitForNetwork({
		isCancelled: () => generation !== startGeneration
	});

	if (!ready) {
		return;
	}

	void checkToken();

	startDiscordBot();

	if (getConfig().scannerEnabled) {
		startScanner(flushNotifications);
	} else {
		logger.info('Scanner disabled (SCANNER_ENABLED=false)');
	}
}
