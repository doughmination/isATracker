/* src/lib/server/github/token.ts
 * MIT — (c) Doughmination System®
 */

import { getConfig, getRepoPath } from '../config.ts';
import { createLogger, describeError } from '../logger.ts';
import { githubRequest } from './client.ts';

const logger = createLogger('token');

// Either scope lets a classic token comment on, review and close PRs in a public repository
const writeScopes = ['public_repo', 'repo'];

interface RepositoryAccess {
	permissions?: {
		triage?: boolean;
		push?: boolean;
	};
}

export interface TokenReport {
	level: 'info' | 'warn' | 'error';
	lines: string[];
}

// Pure, so it can be tested: turns what GitHub said about the token into log lines
export function describeToken(options: {
	login: string;
	scopes: string[] | null;
	canTriage: boolean;
}): TokenReport {
	const { login, scopes, canTriage } = options;
	const lines: string[] = [];
	let level: TokenReport['level'] = 'info';

	if (scopes === null) {
		lines.push(`Signed in as ${login} with a fine-grained token (no scope list to check).`);
	} else if (scopes.some((scope) => writeScopes.includes(scope))) {
		lines.push(`Signed in as ${login} with a classic token (scopes: ${scopes.join(', ')}).`);
	} else {
		level = 'error';
		lines.push(
			`Signed in as ${login}, but the classic token lacks the public_repo scope ` +
				`(scopes: ${scopes.join(', ') || 'none'}). Actions will fail until it is added.`
		);
	}

	if (scopes !== null && scopes.includes('repo')) {
		lines.push('The repo scope also covers private repositories; public_repo is enough.');
	}

	if (!canTriage) {
		level = level === 'error' ? 'error' : 'warn';
		lines.push(
			`${login} has no triage or write access to the repository, so closing PRs will fail.`
		);
	}

	return {
		level,
		lines
	};
}

// Runs once at startup so a bad token is reported then, not at the first button press
export async function checkToken(): Promise<void> {
	const config = getConfig();

	if (config.readGithubToken) {
		try {
			const reader = await githubRequest<{ login: string }>({ path: '/user' });

			logger.info(`READ_GITHUB_TOKEN: signed in as ${reader.data.login}.`);
		} catch (error) {
			logger.error(`Could not verify READ_GITHUB_TOKEN: ${describeError(error)}`);
		}
	} else {
		logger.warn('READ_GITHUB_TOKEN missing; public reads are limited to 60 an hour.');
	}

	if (!config.maintainerGithubToken) {
		logger.warn('MAINTAINER_GITHUB_TOKEN missing; moderation actions will fail.');
		return;
	}

	try {
		const user = await githubRequest<{ login: string }>({
			path: '/user',
			priority: true
		});

		for (const repo of getConfig().repos) {
			const repository = await githubRequest<RepositoryAccess>({
				path: getRepoPath(repo),
				priority: true
			});

			const permissions = repository.data.permissions;

			const report = describeToken({
				login: user.data.login,
				scopes: user.scopes,
				canTriage: Boolean(permissions?.triage || permissions?.push)
			});

			for (const line of report.lines) {
				logger[report.level](`MAINTAINER_GITHUB_TOKEN ${repo}: ${line}`);
			}
		}
	} catch (error) {
		logger.error(`Could not verify MAINTAINER_GITHUB_TOKEN: ${describeError(error)}`);
	}
}
