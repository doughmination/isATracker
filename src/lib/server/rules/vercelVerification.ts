/* src/lib/server/rules/vercelVerification.ts
 * MIT — (c) Doughmination System®
 */

import { repoLabel } from '../../labels.ts';
import type { DomainFile, Rule, Violation } from './types.ts';
import { isPlainObject } from './types.ts';

const verifyPrefix = 'vc-domain-verify=';

function baseName(filePath: string): string {
	return filePath.replace(/^domains\//, '').replace(/\.json$/i, '');
}

// The registered name a file belongs to: domains/_vercel.www.alice.json -> alice
function registeredName(filePath: string, repo: string): string {
	const name = baseName(filePath)
		.replace(/^_vercel\./i, '')
		.replace(new RegExp(`\\.${repoLabel(repo).replaceAll('.', '\\.')}$`, 'i'), '');

	return name.split('.').at(-1) ?? name;
}

// Where Vercel's verification record belongs, e.g. domains/_vercel.alice.json
export function vercelFileFor(filePath: string, repo: string): string {
	return `domains/_vercel.${registeredName(filePath, repo)}.json`;
}

function isVercelFile(filePath: string): boolean {
	return /^_vercel\./i.test(baseName(filePath));
}

// TXT values that are Vercel verification tokens
export function findVercelTxt(json: unknown): string[] {
	if (!isPlainObject(json) || !isPlainObject(json.records)) {
		return [];
	}

	const txt = json.records.TXT ?? json.records.txt;
	const values = Array.isArray(txt) ? txt : [txt];

	return values.filter(
		(value): value is string => typeof value === 'string' && value.trim().startsWith(verifyPrefix)
	);
}

// 1-based line of the first Vercel token, or null
export function findVercelTxtLine(content: string): number | null {
	const lineIndex = content.split('\n').findIndex((line) => line.includes(verifyPrefix));

	return lineIndex === -1 ? null : lineIndex + 1;
}

export const vercelFileNameRule: Rule = {
	id: 'vercelFileName',
	title: 'Vercel verification file has the wrong name',
	severity: 1,
	actionType: 'requestChanges',
	actionLabel: 'Request Changes',

	// The name is the problem, so the comment goes on the file's first line
	findLine: () => 1,

	async evaluate(context) {
		const violations: Violation[] = [];

		for (const file of context.files) {
			const expected = vercelFileFor(file.path, context.pullRequest.repo);

			if (!isVercelFile(file.path) || expected.toLowerCase() === file.path.toLowerCase()) {
				continue;
			}

			violations.push({
				ruleId: 'vercelFileName',
				filePath: file.path,
				reason: `Vercel verification file should be named ${expected}.`
			});
		}

		return violations;
	}
};

export const vercelTxtRecordRule: Rule = {
	id: 'vercelTxtRecord',
	title: 'Vercel TXT record in the domain file',
	severity: 1,
	actionType: 'requestChanges',
	actionLabel: 'Request Changes',

	findLine: (file: DomainFile) => findVercelTxtLine(file.content),

	async evaluate(context) {
		const violations: Violation[] = [];

		for (const file of context.files) {
			if (isVercelFile(file.path) || findVercelTxt(file.json).length === 0) {
				continue;
			}

			violations.push({
				ruleId: 'vercelTxtRecord',
				filePath: file.path,
				reason:
					`A Vercel TXT record is in ${file.path}; it belongs in ` +
					`${vercelFileFor(file.path, context.pullRequest.repo)}.`
			});
		}

		return violations;
	}
};
