/* src/lib/server/config.ts
 * MIT — (c) Doughmination System®
 */

export interface AppConfig {
	githubToken: string;
	// Each entry is owner/name
	repos: string[];
	discordToken: string;
	discordUserId: string;
	discordChannelId: string;
	databasePath: string;
	messagesPath: string;
	unsupportedCnamesPath: string;
	avatarPath: string;
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
		repos: readText('GITHUB_REPOS', 'is-a-dev/register,free-domains/is-a.bot')
			.split(',')
			.map((repo) => repo.trim())
			.filter((repo) => repo !== ''),
		discordToken: readText('DISCORD_BOT_TOKEN'),
		discordUserId: readText('DISCORD_USER_ID'),
		discordChannelId: readText('DISCORD_CHANNEL_ID'),
		databasePath: readText('DATABASE_PATH', 'data/tracker.sqlite'),
		messagesPath: readText('MESSAGES_PATH', 'config/messages.jp'),
		unsupportedCnamesPath: readText('UNSUPPORTED_CNAMES_PATH', 'config/unsupportedCnames.jp'),
		avatarPath: readText('AVATAR_PATH', 'config/avatar.png'),
		pollIntervalSeconds: Math.max(30, readNumber('POLL_INTERVAL_SECONDS', 120)),
		scannerEnabled: readFlag('SCANNER_ENABLED', true),
		// Live by default: approved actions reach GitHub unless DRY_RUN=true
		dryRun: readFlag('DRY_RUN', false),
		dashboardPassword: readText('DASHBOARD_PASSWORD'),
		maxFilesPerPullRequest: readNumber('MAX_FILES_PER_PR', 25),
		nsMinMergedPullRequests: readNumber('NS_MIN_MERGED_PRS', 1),
		rateLimitReserve: readNumber('GITHUB_RATE_LIMIT_RESERVE', 200)
	};

	return cachedConfig;
}

export function getRepoPath(repo: string): string {
	return `/repos/${repo}`;
}

// The dashboard's ?repo= filter; anything not configured means every repository
export function readRepoFilter(url: URL): string | null {
	const repo = url.searchParams.get('repo');

	return repo !== null && getConfig().repos.includes(repo) ? repo : null;
}
