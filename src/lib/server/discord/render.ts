/* src/lib/server/discord/render.ts
 * MIT — (c) Doughmination System®
 */

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	type BaseMessageOptions
} from 'discord.js';

import { repoLabel, severityLabels } from '../../labels.ts';
import { getConfig } from '../config.ts';
import { listFindingsForPullRequest } from '../db/findings.ts';
import { bySeverity, getRule } from '../rules/index.ts';
import type { FindingRow, FindingStatus, FindingWithPullRequest } from '../types.ts';

export const buttonPrefix = 'tracker';

const statusLabels: Record<FindingStatus, string> = {
	pending: 'Awaiting your decision',
	acting: 'Working…',
	actioned: 'Done',
	ignored: 'Ignored',
	resolved: 'Resolved by the contributor',
	prClosed: 'Pull request closed'
};

const statusColours: Record<FindingStatus, number> = {
	pending: 0xeda100,
	acting: 0x2a78d6,
	actioned: 0x1baf7a,
	ignored: 0x8a8a86,
	resolved: 0x8a8a86,
	prClosed: 0x8a8a86
};

function truncate(text: string, maxLength: number): string {
	return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export function buildButtonId(decision: 'approve' | 'ignore', findingId: number): string {
	return `${buttonPrefix}:${decision}:${findingId}`;
}

// Findings shown in one PR message: those already on it, or the unsent pending ones
export function messageGroup(finding: FindingWithPullRequest): FindingRow[] {
	return listFindingsForPullRequest(finding.repo, finding.prNumber)
		.filter((other) =>
			finding.discordMessageId === null
				? other.discordMessageId === null && other.status === 'pending'
				: other.discordMessageId === finding.discordMessageId
		)
		.sort(bySeverity);
}

// The message takes the colour of its most urgent finding
const statusPriority: FindingStatus[] = [
	'pending',
	'acting',
	'actioned',
	'resolved',
	'prClosed',
	'ignored'
];

export function renderPullRequest(finding: FindingWithPullRequest): BaseMessageOptions {
	const group = messageGroup(finding);
	const members = group.length > 0 ? group : [finding];
	const pending = members.filter((member) => member.status === 'pending');

	const leadStatus =
		statusPriority.find((status) => members.some((member) => member.status === status)) ??
		finding.status;

	const latest = [...members].sort((first, second) =>
		second.updatedAt.localeCompare(first.updatedAt)
	)[0];

	const embed = new EmbedBuilder()
		.setTitle(truncate(`${repoLabel(finding.repo)} #${finding.prNumber} · ${finding.title}`, 250))
		.setURL(finding.url)
		.setColor(statusColours[leadStatus])
		.addFields({
			name: 'Author',
			value: `[${finding.author}](https://github.com/${finding.author})`
		});

	// Discord allows 25 fields; a registration PR never comes close
	for (const member of members.slice(0, 20)) {
		const rule = getRule(member.ruleId);

		embed.addFields({
			name: truncate(`${severityLabels[rule.severity]}: ${rule.title}`, 250),
			value: truncate(
				`\`${member.filePath}\`\n${member.reason}\nStatus: ${statusLabels[member.status]}`,
				1000
			)
		});
	}

	if (latest.lastOutcome) {
		embed.addFields({
			name: 'Last result',
			value: truncate(latest.lastOutcome, 1000)
		});
	}

	if (getConfig().dryRun) {
		embed.setFooter({ text: 'Dry run is ON: buttons will not change anything on GitHub' });
	}

	if (pending.length === 0) {
		return {
			embeds: [embed],
			components: []
		};
	}

	const closing = pending.find((member) => getRule(member.ruleId).actionType === 'closePr');
	const countNote = pending.length > 1 ? ` (${pending.length})` : '';

	// Either button acts on every pending finding of the PR
	const approveButton = new ButtonBuilder()
		.setCustomId(buildButtonId('approve', pending[0].id))
		.setLabel(
			closing
				? getRule(closing.ruleId).actionLabel
				: `${getRule(pending[0].ruleId).actionLabel}${countNote}`
		)
		.setStyle(closing ? ButtonStyle.Danger : ButtonStyle.Primary);

	const ignoreButton = new ButtonBuilder()
		.setCustomId(buildButtonId('ignore', pending[0].id))
		.setLabel(pending.length > 1 ? 'Ignore all' : 'Ignore')
		.setStyle(ButtonStyle.Secondary);

	return {
		embeds: [embed],
		components: [new ActionRowBuilder<ButtonBuilder>().addComponents(approveButton, ignoreButton)]
	};
}
