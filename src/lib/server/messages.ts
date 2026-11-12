/* src/lib/server/messages.ts
 * MIT — (c) Doughmination System®
 */

import { readFileSync } from 'node:fs';

import defaultMessages from '../../../config/messages.json' with { type: 'json' };
import { getConfig } from './config.ts';
import { createLogger } from './logger.ts';

const logger = createLogger('messages');

export type ModerationMessages = typeof defaultMessages;

// Read on every use, so wording edits apply without a restart
export function getMessages(): ModerationMessages {
	try {
		const overrides = JSON.parse(
			readFileSync(getConfig().messagesPath, 'utf8')
		) as Partial<ModerationMessages>;

		return {
			nsRecords: {
				...defaultMessages.nsRecords,
				...overrides.nsRecords
			},
			noReplyEmail: {
				...defaultMessages.noReplyEmail,
				...overrides.noReplyEmail
			}
		};
	} catch (error) {
		logger.warn('Could not read the messages file; using built-in wording', error);

		return defaultMessages;
	}
}
