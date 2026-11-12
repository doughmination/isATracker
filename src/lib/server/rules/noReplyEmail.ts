/* src/lib/server/rules/noReplyEmail.ts
 * MIT — (c) Doughmination System®
 */

import type { Rule, Violation } from './types.ts';
import { isPlainObject } from './types.ts';

const noReplyAddress = /^[^@\s]+@users\.noreply\.github\.com$/i;

// Only the owner.email value in the JSON is inspected, never commit or profile emails
export function findNoReplyEmail(json: unknown): string | null {
	if (!isPlainObject(json) || !isPlainObject(json.owner)) {
		return null;
	}

	const email = json.owner.email;

	if (typeof email !== 'string') {
		return null;
	}

	return noReplyAddress.test(email.trim()) ? email.trim() : null;
}

// 1-based line of the owner.email entry, or null when it cannot be pinned down
export function findOwnerEmailLine(content: string, email: string): number | null {
	const lines = content.split('\n');

	const lineIndex = lines.findIndex((line) => /"email"\s*:/.test(line) && line.includes(email));

	return lineIndex === -1 ? null : lineIndex + 1;
}

export const noReplyEmailRule: Rule = {
	id: 'noReplyEmail',
	title: 'GitHub no-reply owner.email',
	actionType: 'requestChanges',
	actionLabel: 'Request Changes',

	async evaluate(context) {
		const violations: Violation[] = [];

		for (const file of context.files) {
			const email = findNoReplyEmail(file.json);

			if (email === null) {
				continue;
			}

			violations.push({
				ruleId: 'noReplyEmail',
				filePath: file.path,
				reason: `owner.email is a GitHub no-reply address (${email}).`
			});
		}

		return violations;
	}
};
