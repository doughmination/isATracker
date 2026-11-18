/* src/lib/server/messages.ts
 * MIT — (c) Doughmination System®
 */

import { readFileSync } from 'node:fs';
import { loads } from 'jpcl-lang';

import { getConfig } from './config.ts';
import { createLogger } from './logger.ts';

const logger = createLogger('messages');

export type ModerationMessages = {
	nsRecords: {
		closeComment: string;
	};
	unsupportedCname: {
		reviewComment: string;
		reviewDismissal: string;
		reviewSummary: string;
	};
	noReplyEmail: {
		reviewComment: string;
		reviewDismissal: string;
		reviewSummary: string;
	};
	vercelLogin: {
		reviewComment: string;
		reviewDismissal: string;
		reviewSummary: string;
	};
};

// The committed file, read once, so a later bad edit still has wording to fall back on
let defaultMessages: ModerationMessages | null = null;

function getDefaultMessages(): ModerationMessages {
	defaultMessages ??= loads(readFileSync('config/messages.jp', 'utf8')) as ModerationMessages;

	return defaultMessages;
}

// Read on every use, so wording edits apply without a restart
export function getMessages(): ModerationMessages {
	const defaultMessages = getDefaultMessages();

	try {
		const overrides = loads(
			readFileSync(getConfig().messagesPath, 'utf8')
		) as Partial<ModerationMessages>;

		return {
			nsRecords: {
				...defaultMessages.nsRecords,
				...overrides.nsRecords
			},
			unsupportedCname: {
				...defaultMessages.unsupportedCname,
				...overrides.unsupportedCname
			},
			noReplyEmail: {
				...defaultMessages.noReplyEmail,
				...overrides.noReplyEmail
			},
			vercelLogin: {
				...defaultMessages.vercelLogin,
				...overrides.vercelLogin
			}
		};
	} catch (error) {
		logger.warn('Could not read the messages file; using built-in wording', error);

		return defaultMessages;
	}
}
