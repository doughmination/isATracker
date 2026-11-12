/* src/lib/server/types.ts
 * MIT — (c) Doughmination System®
 */

export type RuleId = 'nsRecords' | 'noReplyEmail';

export type ActionType = 'closePr' | 'requestChanges' | 'ignore';

export type ActionSource = 'discord' | 'dashboard';

export type ActionStatus = 'success' | 'failure' | 'skipped' | 'dryRun';

export type FindingStatus = 'pending' | 'acting' | 'actioned' | 'ignored' | 'resolved' | 'prClosed';

export interface PullRequestSummary {
	number: number;
	title: string;
	author: string;
	authorAssociation: string;
	url: string;
	state: 'open' | 'closed';
	headSha: string;
	updatedAt: string;
}

export interface PullRequestRow extends PullRequestSummary {
	scannedSha: string | null;
	scannedAt: string | null;
}

export interface FindingRow {
	id: number;
	prNumber: number;
	ruleId: RuleId;
	filePath: string;
	headSha: string;
	reason: string;
	status: FindingStatus;
	lastOutcome: string | null;
	commentId: number | null;
	discordChannelId: string | null;
	discordMessageId: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface FindingWithPullRequest extends FindingRow {
	title: string;
	author: string;
	url: string;
}

export interface ActionRow {
	id: number;
	findingId: number | null;
	prNumber: number;
	contributor: string;
	ruleId: RuleId;
	actionType: ActionType;
	source: ActionSource;
	status: ActionStatus;
	detail: string;
	githubUrl: string | null;
	createdAt: string;
}

export interface ActionOutcome {
	status: ActionStatus;
	summary: string;
	githubUrl?: string;
}
