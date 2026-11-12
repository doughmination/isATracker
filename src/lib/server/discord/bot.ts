/* src/lib/server/discord/bot.ts
 * MIT — (c) Doughmination System®
 */

import { Client, Events, MessageFlags, type Interaction } from 'discord.js';

import { getConfig } from '../config.ts';
import { getFinding, listUnnotifiedFindings, setFindingDiscordMessage } from '../db/findings.ts';
import { onFindingEvent } from '../events.ts';
import { createLogger } from '../logger.ts';
import { performModerationAction, type ModerationDecision } from '../moderation/actions.ts';
import { buttonPrefix, renderFinding } from './render.ts';

const logger = createLogger('discord');

let client: Client | undefined;

function isReady(): boolean {
	return client?.isReady() ?? false;
}

// Findings with a send in flight, so the event path and the catch-up path never double-post
const sendsInFlight = new Set<number>();

async function sendNotification(findingId: number): Promise<void> {
	if (sendsInFlight.has(findingId)) {
		return;
	}

	sendsInFlight.add(findingId);

	try {
		await deliverNotification(findingId);
	} finally {
		sendsInFlight.delete(findingId);
	}
}

// Sends to the configured channel when set, otherwise as a direct message
async function deliverNotification(findingId: number): Promise<void> {
	const finding = getFinding(findingId);

	if (!client || !isReady() || !finding) {
		return;
	}

	if (finding.status !== 'pending' || finding.discordMessageId !== null) {
		return;
	}

	const { discordChannelId, discordUserId } = getConfig();
	const payload = renderFinding(finding);

	if (discordChannelId) {
		const channel = await client.channels.fetch(discordChannelId);

		if (!channel?.isSendable()) {
			throw new Error(`Channel ${discordChannelId} cannot receive messages`);
		}

		const message = await channel.send(payload);

		setFindingDiscordMessage(finding.id, message.channelId, message.id);
		return;
	}

	const user = await client.users.fetch(discordUserId);
	const message = await user.send(payload);

	setFindingDiscordMessage(finding.id, message.channelId, message.id);
}

async function refreshNotification(findingId: number): Promise<void> {
	const finding = getFinding(findingId);

	if (!client || !isReady() || !finding) {
		return;
	}

	if (finding.discordChannelId === null || finding.discordMessageId === null) {
		return;
	}

	const channel = await client.channels.fetch(finding.discordChannelId);

	if (!channel?.isTextBased()) {
		return;
	}

	await channel.messages.edit(finding.discordMessageId, renderFinding(finding));
}

// Catches up on findings that could not be delivered earlier
export async function flushNotifications(): Promise<void> {
	if (!isReady()) {
		return;
	}

	for (const finding of listUnnotifiedFindings()) {
		await sendNotification(finding.id);
	}
}

async function handleInteraction(interaction: Interaction): Promise<void> {
	if (!interaction.isButton()) {
		return;
	}

	const [prefix, decision, findingIdText] = interaction.customId.split(':');
	const findingId = Number(findingIdText);

	if (prefix !== buttonPrefix || !Number.isInteger(findingId)) {
		return;
	}

	if (decision !== 'approve' && decision !== 'ignore') {
		return;
	}

	if (interaction.user.id !== getConfig().discordUserId) {
		await interaction.reply({
			content: 'Only the configured moderator can use these buttons.',
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	// Acknowledge within Discord's 3 second window, then do the slow GitHub work
	await interaction.deferUpdate();

	const outcome = await performModerationAction({
		findingId,
		decision: decision satisfies ModerationDecision,
		source: 'discord'
	});

	logger.info(`Finding ${findingId} ${decision}: ${outcome.status}`);

	// The findingChanged event redraws the message; this covers a finding that was already handled
	await refreshNotification(findingId);
}

export async function startDiscordBot(): Promise<void> {
	const { discordToken, discordUserId } = getConfig();

	if (!discordToken || !discordUserId) {
		logger.warn('DISCORD_BOT_TOKEN or DISCORD_USER_ID missing; Discord is disabled');
		return;
	}

	// Buttons and direct messages need no privileged gateway intents
	client = new Client({ intents: [] });

	client.once(Events.ClientReady, (readyClient) => {
		logger.info(`Connected as ${readyClient.user.tag}`);

		void flushNotifications().catch((error) => logger.warn('Catch-up failed', error));
	});

	client.on(Events.InteractionCreate, (interaction) => {
		void handleInteraction(interaction).catch((error) => logger.error('Interaction failed', error));
	});

	client.on(Events.Error, (error) => logger.error('Gateway error', error));

	onFindingEvent('findingCreated', (findingId) => {
		void sendNotification(findingId).catch((error) =>
			logger.warn(`Could not notify finding ${findingId}; will retry after the next scan`, error)
		);
	});

	onFindingEvent('findingChanged', (findingId) => {
		void refreshNotification(findingId).catch((error) =>
			logger.warn(`Could not update the message for finding ${findingId}`, error)
		);
	});

	await client.login(discordToken);
}

export async function stopDiscordBot(): Promise<void> {
	await client?.destroy();
	client = undefined;
}
