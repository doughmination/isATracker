/* src/lib/server/rules/index.ts
 * MIT — (c) Doughmination System®
 */

import type { RuleId } from '../types.ts';
import { noReplyEmailRule } from './noReplyEmail.ts';
import { nsRecordsRule } from './nsRecords.ts';
import type { Rule } from './types.ts';
import { unsupportedCnameRule } from './unsupportedCname.ts';
import { vercelLoginRule } from './vercelLogin.ts';

// Add a new rule module here and the scanner, Discord and dashboard all pick it up
export const rules: Rule[] = [
	nsRecordsRule,
	unsupportedCnameRule,
	vercelLoginRule,
	noReplyEmailRule
];

export function getRule(ruleId: RuleId): Rule {
	const rule = rules.find((candidate) => candidate.id === ruleId);

	if (!rule) {
		throw new Error(`Unknown rule: ${ruleId}`);
	}

	return rule;
}

// Sort comparator: highest severity first, then the caller's existing order
export function bySeverity(first: { ruleId: RuleId }, second: { ruleId: RuleId }): number {
	return getRule(second.ruleId).severity - getRule(first.ruleId).severity;
}
