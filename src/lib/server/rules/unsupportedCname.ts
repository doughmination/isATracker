/* src/lib/server/rules/unsupportedCname.ts
 * MIT — (c) Doughmination System®
 */

import { readFileSync } from 'node:fs';
import { loads } from 'jpcl-lang';

import { getConfig } from '../config.ts';
import { createLogger } from '../logger.ts';
import type { DomainFile, Rule, Violation } from './types.ts';
import { isPlainObject } from './types.ts';

const logger = createLogger('unsupportedCname');

// ".Example.com.", "*.example.com" and "example.com" are the same host
function normaliseHost(host: string): string {
	return host
		.trim()
		.toLowerCase()
		.replace(/^(\*?\.)+/, '')
		.replace(/\.$/, '');
}

// Read on every scan, so list edits apply without a restart
export function getUnsupportedCnames(): string[] {
	try {
		const file = loads(readFileSync(getConfig().unsupportedCnamesPath, 'utf8'));
		const list: unknown = file.hosts;

		if (!Array.isArray(list)) {
			throw new Error('expected a "hosts" array of hostnames');
		}

		return list.filter(
			(entry): entry is string => typeof entry === 'string' && normaliseHost(entry) !== ''
		);
	} catch (error) {
		logger.warn('Could not read the unsupported CNAME list; skipping this rule', error);

		return [];
	}
}

// An entry matches itself and every subdomain under it
export function findUnsupportedCname(json: unknown, unsupportedHosts: string[]): string | null {
	if (!isPlainObject(json)) {
		return null;
	}

	// Older registrations use "record"; current ones use "records"
	const records = json.records ?? json.record;

	if (!isPlainObject(records)) {
		return null;
	}

	const cnameKey = Object.keys(records).find((key) => key.trim().toUpperCase() === 'CNAME');
	const target = cnameKey === undefined ? undefined : records[cnameKey];

	if (typeof target !== 'string') {
		return null;
	}

	const host = normaliseHost(target);

	const blocked = unsupportedHosts
		.map(normaliseHost)
		.some((unsupported) => host === unsupported || host.endsWith(`.${unsupported}`));

	return blocked ? target.trim() : null;
}

// 1-based line of the CNAME entry, or null when it cannot be pinned down
export function findCnameLine(content: string): number | null {
	const lineIndex = content.split('\n').findIndex((line) => /"cname"\s*:/i.test(line));

	return lineIndex === -1 ? null : lineIndex + 1;
}

export const unsupportedCnameRule: Rule = {
	id: 'unsupportedCname',
	title: 'CNAME to an unsupported host',
	severity: 2,
	actionType: 'requestChanges',
	actionLabel: 'Request Changes',

	findLine: (file: DomainFile) => findCnameLine(file.content),

	async evaluate(context) {
		const unsupportedHosts = getUnsupportedCnames();
		const violations: Violation[] = [];

		if (unsupportedHosts.length === 0) {
			return violations;
		}

		for (const file of context.files) {
			const target = findUnsupportedCname(file.json, unsupportedHosts);

			if (target === null) {
				continue;
			}

			violations.push({
				ruleId: 'unsupportedCname',
				filePath: file.path,
				reason: `CNAME points at an unsupported host (${target}).`
			});
		}

		return violations;
	}
};
