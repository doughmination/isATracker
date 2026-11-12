/* src/lib/server/auth.ts
 * MIT — (c) Doughmination System®
 */

import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { getConfig } from './config.ts';
import { getValue, setValue } from './db/keyValue.ts';

export const sessionCookieName = 'trackerSession';

const sessionSecretKey = 'auth.sessionSecret';

function getSessionSecret(): string {
	const existing = getValue(sessionSecretKey);

	if (existing) {
		return existing;
	}

	const secret = randomBytes(32).toString('hex');

	setValue(sessionSecretKey, secret);

	return secret;
}

function safeEqual(first: string, second: string): boolean {
	const firstBuffer = Buffer.from(first);
	const secondBuffer = Buffer.from(second);

	return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

export function isPasswordConfigured(): boolean {
	return getConfig().dashboardPassword !== '';
}

export function isPasswordCorrect(candidate: string): boolean {
	return isPasswordConfigured() && safeEqual(candidate, getConfig().dashboardPassword);
}

// Tied to the password, so changing the password signs every browser out
export function createSessionToken(): string {
	return createHmac('sha256', getSessionSecret())
		.update(getConfig().dashboardPassword)
		.digest('hex');
}

export function isSessionValid(token: string | undefined): boolean {
	return token !== undefined && isPasswordConfigured() && safeEqual(token, createSessionToken());
}
