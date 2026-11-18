/* src/lib/server/rules/vercelLogin.ts
 * MIT — (c) Doughmination System®
 */

import { createLogger } from '../logger.ts';
import type { Rule, Violation } from './types.ts';

const logger = createLogger('vercelLogin');

const previewSection =
	/<!--\s*WEBSITE_PREVIEW_START\s*-->([\s\S]*?)<!--\s*WEBSITE_PREVIEW_END\s*-->/;
const vercelLink = /https?:\/\/[a-z0-9.-]+\.vercel\.app[^\s<>()"'`,]*/gi;

// Vercel Authentication hops vercel.app -> vercel.com/sso-api -> vercel.com/login
const maxRedirects = 5;
const timeoutMs = 10_000;

// Vercel links in the template's preview section, or the whole body when the markers are gone
export function findVercelLinks(body: string): string[] {
	const withoutComments = (previewSection.exec(body)?.[1] ?? body).replace(/<!--[\s\S]*?-->/g, '');

	return [...new Set(withoutComments.match(vercelLink) ?? [])];
}

function isVercelHost(url: URL): boolean {
	return url.hostname === 'vercel.com' || url.hostname.endsWith('.vercel.app');
}

// Follows redirects by hand so a link can never send us off Vercel's own hosts
export async function redirectsToVercelLogin(link: string): Promise<boolean> {
	let url = new URL(link);

	for (let hop = 0; hop <= maxRedirects; hop += 1) {
		if (url.hostname === 'vercel.com' && url.pathname === '/login') {
			return true;
		}

		if (url.protocol !== 'https:' || !isVercelHost(url)) {
			return false;
		}

		const response = await fetch(url, {
			redirect: 'manual',
			signal: AbortSignal.timeout(timeoutMs)
		});

		await response.body?.cancel();

		const location = response.headers.get('location');

		if (response.status < 300 || response.status >= 400 || location === null) {
			return false;
		}

		url = new URL(location, url);
	}

	return false;
}

export const vercelLoginRule: Rule = {
	id: 'vercelLogin',
	title: 'Vercel preview behind a login',
	severity: 2,
	actionType: 'requestChanges',
	actionLabel: 'Request Changes',

	async evaluate(context) {
		const violations: Violation[] = [];

		for (const link of findVercelLinks(context.pullRequest.body)) {
			try {
				if (await redirectsToVercelLogin(link)) {
					violations.push({
						ruleId: 'vercelLogin',
						filePath: link,
						reason: `The website preview (${link}) redirects to the Vercel login page.`
					});
				}
			} catch (error) {
				// Unreachable is not the same as protected; never flag on a network error
				logger.warn(`Could not check ${link}`, error);
			}
		}

		return violations;
	}
};
