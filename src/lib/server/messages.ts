/* src/lib/server/messages.ts
 * MIT — (c) Doughmination System®
 */

import { readFileSync } from 'node:fs';
import { loads } from 'jpcl-lang';

import { getConfig } from './config.ts';
import { createLogger } from './logger.ts';

const logger = createLogger('messages');

export interface ReviewMessages {
	reviewComment: string;
	reviewDismissal: string;
	reviewSummary: string;
}

export type ModerationMessages = {
	nsRecords: {
		closeComment: string;
	};
	// Used when one review covers several violations
	combined: {
		reviewSummary: string;
	};
	unsupportedCname: ReviewMessages & { closeComment: string };
	noReplyEmail: ReviewMessages;
	vercelLogin: ReviewMessages;
	vercelFileName: ReviewMessages;
	vercelTxtRecord: ReviewMessages;
};

// The committed file, read once, so a later bad edit still has wording to fall back on
let defaultMessages: ModerationMessages | null = null;

function getDefaultMessages(): ModerationMessages {
	defaultMessages ??= loads(
		readFileSync('config/messages.jp', 'utf8')
	) as unknown as ModerationMessages;

	return defaultMessages;
}

// Read on every use, so wording edits apply without a restart
export function getMessages(): ModerationMessages {
	const defaultMessages = getDefaultMessages();

	try {
		const overrides = loads(
			readFileSync(getConfig().messagesPath, 'utf8')
		) as Partial<ModerationMessages>;

		// Each section falls back key by key to the committed wording
		const merged: Record<string, object> = {};

		for (const [section, wording] of Object.entries(defaultMessages)) {
			merged[section] = {
				...wording,
				...overrides[section as keyof ModerationMessages]
			};
		}

		return merged as ModerationMessages;
	} catch (error) {
		logger.warn('Could not read the messages file; using built-in wording', error);

		return defaultMessages;
	}
}
