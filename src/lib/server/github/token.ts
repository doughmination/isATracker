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
	if (!getConfig().githubToken) {
		logger.warn('GITHUB_TOKEN missing; reads are limited to 60 an hour and actions will fail');
		return;
	}

	try {
		const user = await githubRequest<{ login: string }>({
			path: '/user',
			priority: true
		});

		const repository = await githubRequest<RepositoryAccess>({
			path: getRepoPath(),
			priority: true
		});

		const permissions = repository.data.permissions;

		const report = describeToken({
			login: user.data.login,
			scopes: user.scopes,
			canTriage: Boolean(permissions?.triage || permissions?.push)
		});

		for (const line of report.lines) {
			logger[report.level](line);
		}
	} catch (error) {
		logger.error(`Could not verify GITHUB_TOKEN: ${describeError(error)}`);
	}
}
