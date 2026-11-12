/* src/routes/logout/+server.ts
 * MIT — (c) Doughmination System®
 */

import { redirect, type RequestHandler } from '@sveltejs/kit';

import { sessionCookieName } from '#lib/server/auth.ts';

export const POST: RequestHandler = ({ cookies }) => {
	cookies.delete(sessionCookieName, { path: '/' });

	redirect(303, '/login');
};
