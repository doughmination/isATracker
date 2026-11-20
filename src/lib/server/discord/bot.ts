/* src/lib/server/discord/bot.ts
 * MIT — (c) Doughmination System®
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Client, Events, MessageFlags, type ClientUser, type Interaction } from 'discord.js';

import { getConfig } from '../config.ts';
import {
	getFinding,
	listFindingsForPullRequest,
	listUnnotifiedFindings,
	setFindingDiscordMessage
} from '../db/findings.ts';
import { getValue, setValue } from '../db/keyValue.ts';
import { onFindingEvent } from '../events.ts';
import { createLogger, sleep } from '../logger.ts';
import { performModerationAction, type ModerationDecision } from '../moderation/actions.ts';
import { bySeverity } from '../rules/index.ts';
import { buttonPrefix, messageGroup, renderPullRequest } from './render.ts';

const logger = createLogger('discord');

let client: Client | undefined;

function isReady(): boolean {
	return client?.isReady() ?? false;
}

// PRs with a send in flight, so the event path and the catch-up path never double-post.
// A finding skipped here is attached by the send in flight, or by the next catch-up.
const sendsInFlight = new Set<string>();

async function sendNotification(findingId: number): Promise<void> {
	const finding = getFinding(findingId);

	if (!finding) {
		return;
	}

	const pullRequestKey = `${finding.repo}#${finding.prNumber}`;

	if (sendsInFlight.has(pullRequestKey)) {
		return;
	}

	sendsInFlight.add(pullRequestKey);

	try {
		await deliverNotification(findingId);
	} finally {
		sendsInFlight.delete(pullRequestKey);
	}
}

// One message per PR: joins a live message for the PR, or sends a new one
async function deliverNotification(findingId: number): Promise<void> {
	const finding = getFinding(findingId);

	if (!client || !isReady() || !finding) {
		return;
	}

	if (finding.status !== 'pending' || finding.discordMessageId !== null) {
		return;
	}

	const live = listFindingsForPullRequest(finding.repo, finding.prNumber).find(
		(other) =>
			other.discordChannelId !== null &&
			other.discordMessageId !== null &&
			(other.status === 'pending' || other.status === 'acting')
	);

	if (live?.discordChannelId && live.discordMessageId) {
		setFindingDiscordMessage(finding.id, live.discordChannelId, live.discordMessageId);
		await refreshNotification(finding.id);
		return;
	}

	// Sends to the configured channel when set, otherwise as a direct message
	const { discordChannelId, discordUserId } = getConfig();
	const channel = discordChannelId ? await client.channels.fetch(discordChannelId) : null;

	if (discordChannelId && !channel?.isSendable()) {
		throw new Error(`Channel ${discordChannelId} cannot receive messages`);
	}

	const target = channel?.isSendable() ? channel : await client.users.fetch(discordUserId);

	// Rendered after the fetch, so findings from the same scan are all in it
	const rendered = messageGroup(finding);
	const message = await target.send(renderPullRequest(finding));
	const unsent = messageGroup(finding);

	for (const member of unsent) {
		setFindingDiscordMessage(member.id, message.channelId, message.id);
	}

	// A finding that arrived while the message was being sent
	if (unsent.length !== rendered.length) {
		await refreshNotification(finding.id);
	}
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

	await channel.messages.edit(finding.discordMessageId, renderPullRequest(finding));
}

// Catches up on findings that could not be delivered earlier
export async function flushNotifications(): Promise<void> {
	if (!isReady()) {
		return;
	}

	for (const finding of listUnnotifiedFindings().sort(bySeverity)) {
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

const avatarHashKey = 'discordAvatarHash';

// Uploads config/avatar.png only when it changed, since Discord rate-limits avatar edits
async function syncAvatar(user: ClientUser): Promise<void> {
	const image = readFileSync(getConfig().avatarPath);
	const hash = createHash('sha256').update(image).digest('hex');

	if (getValue(avatarHashKey) === hash) {
		return;
	}

	await user.setAvatar(image);
	setValue(avatarHashKey, hash);

	logger.info('Updated the bot avatar from the avatar file');
}

function createClient(): Client {
	// Buttons and direct messages need no privileged gateway intents
	const newClient = new Client({ intents: [] });

	newClient.once(Events.ClientReady, (readyClient) => {
		logger.info(`Connected as ${readyClient.user.tag}`);

		void syncAvatar(readyClient.user).catch((error) =>
			logger.warn('Could not update the bot avatar; will try again next start', error)
		);

		void flushNotifications().catch((error) => logger.warn('Catch-up failed', error));
	});

	newClient.on(Events.InteractionCreate, (interaction) => {
		void handleInteraction(interaction).catch((error) => logger.error('Interaction failed', error));
	});

	newClient.on(Events.Error, (error) => logger.error('Gateway error', error));

	return newClient;
}

const retryDelaysSeconds = [5, 15, 30, 60];

// Each start gets a new number, so a stop or restart ends any older login loop
let loginGeneration = 0;

function isBadToken(error: unknown): boolean {
	return (error as { code?: string } | null)?.code === 'TokenInvalid';
}

// Keeps trying until Discord accepts the login, e.g. when the service starts before the network
async function loginWithRetry(discordToken: string, generation: number): Promise<void> {
	for (let attempt = 0; generation === loginGeneration; attempt += 1) {
		const candidate = createClient();

		client = candidate;

		try {
			await candidate.login(discordToken);
			return;
		} catch (error) {
			await candidate.destroy().catch(() => undefined);

			if (isBadToken(error)) {
				logger.error('DISCORD_BOT_TOKEN was rejected; Discord is disabled', error);
				return;
			}

			const delaySeconds = retryDelaysSeconds[Math.min(attempt, retryDelaysSeconds.length - 1)];

			logger.warn(`Discord login failed; retrying in ${delaySeconds}s`, error);

			await sleep(delaySeconds * 1000);
		}
	}
}

export function startDiscordBot(): void {
	const { discordToken, discordUserId } = getConfig();

	if (!discordToken || !discordUserId) {
		logger.warn('DISCORD_BOT_TOKEN or DISCORD_USER_ID missing; Discord is disabled');
		return;
	}

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

	loginGeneration += 1;

	// Not awaited: the scanner and dashboard start while Discord is still connecting
	void loginWithRetry(discordToken, loginGeneration);
}

export async function stopDiscordBot(): Promise<void> {
	loginGeneration += 1;

	await client?.destroy();
	client = undefined;
}
