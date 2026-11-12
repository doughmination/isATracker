/* src/lib/server/rules/nsRecords.ts
 * MIT — (c) Doughmination System®
 */

import type { Rule, Violation } from './types.ts';
import { isPlainObject } from './types.ts';

// Returns the nameservers a registration file actually requests
export function findNsRecords(json: unknown): string[] {
	if (!isPlainObject(json)) {
		return [];
	}

	// Older registrations use "record"; current ones use "records"
	const records = json.records ?? json.record;

	if (!isPlainObject(records)) {
		return [];
	}

	const nsKey = Object.keys(records).find((key) => key.trim().toUpperCase() === 'NS');

	if (nsKey === undefined) {
		return [];
	}

	const value = records[nsKey];
	const entries = Array.isArray(value) ? value : [value];

	return entries
		.filter((entry) => typeof entry === 'string' && entry.trim() !== '')
		.map((entry) => String(entry).trim());
}

export const nsRecordsRule: Rule = {
	id: 'nsRecords',
	title: 'NS records from a first-time contributor',
	actionType: 'closePr',
	actionLabel: 'Close PR',

	async evaluate(context) {
		const violations: Violation[] = [];

		for (const file of context.files) {
			const nameservers = findNsRecords(file.json);

			if (nameservers.length === 0) {
				continue;
			}

			const eligibility = await context.getEligibility();

			if (eligibility.eligible) {
				return [];
			}

			violations.push({
				ruleId: 'nsRecords',
				filePath: file.path,
				reason: `Requests NS records (${nameservers.join(', ')}). ${eligibility.explanation}`
			});
		}

		return violations;
	}
};
