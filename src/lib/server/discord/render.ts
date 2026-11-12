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

import { getConfig } from '../config.ts';
import { getRule } from '../rules/index.ts';
import type { FindingStatus, FindingWithPullRequest } from '../types.ts';

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

export function renderFinding(finding: FindingWithPullRequest): BaseMessageOptions {
	const rule = getRule(finding.ruleId);

	const embed = new EmbedBuilder()
		.setTitle(truncate(`#${finding.prNumber} · ${finding.title}`, 250))
		.setURL(finding.url)
		.setColor(statusColours[finding.status])
		.addFields(
			{
				name: 'Violation',
				value: rule.title
			},
			{
				name: 'Author',
				value: `[${finding.author}](https://github.com/${finding.author})`,
				inline: true
			},
			{
				name: 'File',
				value: `\`${finding.filePath}\``,
				inline: true
			},
			{
				name: 'Reason',
				value: truncate(finding.reason, 1000)
			},
			{
				name: 'Status',
				value: statusLabels[finding.status]
			}
		);

	if (finding.lastOutcome) {
		embed.addFields({
			name: 'Last result',
			value: truncate(finding.lastOutcome, 1000)
		});
	}

	if (getConfig().dryRun) {
		embed.setFooter({ text: 'Dry run is ON: buttons will not change anything on GitHub' });
	}

	if (finding.status !== 'pending') {
		return {
			embeds: [embed],
			components: []
		};
	}

	const approveButton = new ButtonBuilder()
		.setCustomId(buildButtonId('approve', finding.id))
		.setLabel(rule.actionLabel)
		.setStyle(rule.actionType === 'closePr' ? ButtonStyle.Danger : ButtonStyle.Primary);

	const ignoreButton = new ButtonBuilder()
		.setCustomId(buildButtonId('ignore', finding.id))
		.setLabel('Ignore')
		.setStyle(ButtonStyle.Secondary);

	return {
		embeds: [embed],
		components: [new ActionRowBuilder<ButtonBuilder>().addComponents(approveButton, ignoreButton)]
	};
}
