/* src/lib/server/rules/index.ts
 * MIT — (c) Doughmination System®
 */

import type { RuleId } from '../types.ts';
import { noReplyEmailRule } from './noReplyEmail.ts';
import { nsRecordsRule } from './nsRecords.ts';
import type { Rule } from './types.ts';

// Add a new rule module here and the scanner, Discord and dashboard all pick it up
export const rules: Rule[] = [nsRecordsRule, noReplyEmailRule];

export function getRule(ruleId: RuleId): Rule {
	const rule = rules.find((candidate) => candidate.id === ruleId);

	if (!rule) {
		throw new Error(`Unknown rule: ${ruleId}`);
	}

	return rule;
}
