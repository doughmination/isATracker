/* src/lib/server/config.ts
 * MIT — (c) Doughmination System®
 */

export interface AppConfig {
	githubToken: string;
	repoOwner: string;
	repoName: string;
	discordToken: string;
	discordUserId: string;
	discordChannelId: string;
	databasePath: string;
	messagesPath: string;
	pollIntervalSeconds: number;
	scannerEnabled: boolean;
	dryRun: boolean;
	dashboardPassword: string;
	maxFilesPerPullRequest: number;
	nsMinMergedPullRequests: number;
	rateLimitReserve: number;
}

function readText(name: string, fallback = ''): string {
	const value = process.env[name];

	return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function readNumber(name: string, fallback: number): number {
	const parsed = Number(readText(name));

	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readFlag(name: string, fallback: boolean): boolean {
	const value = readText(name).toLowerCase();

	if (value === '') {
		return fallback;
	}

	return ['1', 'true', 'yes', 'on'].includes(value);
}

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
	cachedConfig ??= {
		githubToken: readText('GITHUB_TOKEN'),
		repoOwner: readText('GITHUB_REPO_OWNER', 'is-a-dev'),
		repoName: readText('GITHUB_REPO_NAME', 'register'),
		discordToken: readText('DISCORD_BOT_TOKEN'),
		discordUserId: readText('DISCORD_USER_ID'),
		discordChannelId: readText('DISCORD_CHANNEL_ID'),
		databasePath: readText('DATABASE_PATH', 'data/tracker.sqlite'),
		messagesPath: readText('MESSAGES_PATH', 'config/messages.json'),
		pollIntervalSeconds: Math.max(30, readNumber('POLL_INTERVAL_SECONDS', 120)),
		scannerEnabled: readFlag('SCANNER_ENABLED', true),
		// Dry run is the default: nothing is sent to GitHub until it is switched off
		dryRun: readFlag('DRY_RUN', true),
		dashboardPassword: readText('DASHBOARD_PASSWORD'),
		maxFilesPerPullRequest: readNumber('MAX_FILES_PER_PR', 25),
		nsMinMergedPullRequests: readNumber('NS_MIN_MERGED_PRS', 1),
		rateLimitReserve: readNumber('GITHUB_RATE_LIMIT_RESERVE', 200)
	};

	return cachedConfig;
}

export function getRepoPath(): string {
	const { repoOwner, repoName } = getConfig();

	return `/repos/${repoOwner}/${repoName}`;
}
