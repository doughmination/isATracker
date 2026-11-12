/* src/routes/login/+page.server.ts
 * MIT — (c) Doughmination System®
 */

import { fail, redirect } from '@sveltejs/kit';

import {
	createSessionToken,
	isPasswordConfigured,
	isPasswordCorrect,
	isSessionValid,
	sessionCookieName
} from '#lib/server/auth.ts';
import { sleep } from '#lib/server/logger.ts';

import type { Actions, PageServerLoad } from './$types';

const sessionLengthSeconds = 60 * 60 * 24 * 30;

export const load: PageServerLoad = ({ cookies }) => {
	if (!isPasswordConfigured() || isSessionValid(cookies.get(sessionCookieName))) {
		redirect(303, '/');
	}
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const formData = await request.formData();
		const password = String(formData.get('password') ?? '');

		if (!isPasswordCorrect(password)) {
			// Slows down guessing
			await sleep(750);

			return fail(401, { problem: 'Wrong password.' });
		}

		cookies.set(sessionCookieName, createSessionToken(), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: sessionLengthSeconds
		});

		redirect(303, '/');
	}
};
