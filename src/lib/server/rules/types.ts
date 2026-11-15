/* src/lib/server/rules/types.ts
 * MIT — (c) Doughmination System®
 */

import type { ActionType, PullRequestSummary, RuleId } from '../types.ts';

export interface DomainFile {
	path: string;
	status: string;
	patch: string | undefined;
	content: string;
	// null when the file is not valid JSON
	json: unknown;
}

export interface ContributorEligibility {
	eligible: boolean;
	explanation: string;
}

export interface RuleContext {
	pullRequest: PullRequestSummary;
	files: DomainFile[];
	// Lazy, so the contributor lookup only runs when a rule needs it
	getEligibility: () => Promise<ContributorEligibility>;
}

export interface Violation {
	ruleId: RuleId;
	filePath: string;
	reason: string;
}

export interface Rule {
	id: RuleId;
	title: string;
	// 3 = most serious; a PR crossing several rules is led by its highest
	severity: 1 | 2 | 3;
	actionType: Exclude<ActionType, 'ignore'>;
	actionLabel: string;
	// Line for an inline review comment; only requestChanges rules need it
	findLine?: (file: DomainFile) => number | null;
	evaluate: (context: RuleContext) => Promise<Violation[]>;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
