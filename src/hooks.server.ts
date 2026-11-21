/* src/hooks.server.ts
 * MIT — (c) Doughmination System®
 */

import { building, dev } from '$app/env';
import { redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';

import { isPasswordConfigured, isSessionValid, sessionCookieName } from '#lib/server/auth.ts';
import { startServices } from '#lib/server/runtime.ts';

// Starts the scanner and the Discord bot inside the same process as the dashboard
export const init: ServerInit = async () => {
	if (!building) {
		await startServices();
	}
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.authenticated =
		isSessionValid(event.cookies.get(sessionCookieName)) || (dev && !isPasswordConfigured());

	if (['/', '/history', '/lookup', '/login'].includes(event.route.id ?? '')) {
		return resolve(event);
	}

	if (!isPasswordConfigured()) {
		// Without a password, moderation only opens on the local dev server
		if (dev) {
			return resolve(event);
		}

		return new Response('Set DASHBOARD_PASSWORD to use the dashboard.', { status: 503 });
	}

	if (!event.locals.authenticated) {
		redirect(303, '/login');
	}

	return resolve(event);
};
