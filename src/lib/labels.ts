/* src/lib/labels.ts
 * MIT — (c) Doughmination System®
 */

// Display wording shared by the dashboard pages; safe to load in the browser

export const ruleLabels: Record<string, string> = {
	nsRecords: 'NS records (first-time contributor)',
	unsupportedCname: 'Unsupported CNAME target',
	noReplyEmail: 'No-reply owner.email',
	vercelLogin: 'Vercel preview behind a login',
	vercelFileName: 'Misnamed _vercel file',
	vercelTxtRecord: 'Vercel TXT in the domain file'
};

export const severityLabels: Record<number, string> = {
	3: 'High',
	2: 'Medium',
	1: 'Low'
};

export const actionLabels: Record<string, string> = {
	closePr: 'Close PR',
	requestChanges: 'Request Changes',
	ignore: 'Ignore'
};

export const statusLabels: Record<string, string> = {
	success: 'Success',
	failure: 'Failed',
	skipped: 'Skipped',
	dryRun: 'Dry run'
};

// is-a-dev/register -> is-a.dev, free-domains/is-a.bot -> is-a.bot
export function repoLabel(repo: string): string {
	const [owner, name] = repo.split('/');

	// shortcut: guesses the service from the repo name, fine for the is-a family
	return name.includes('.') ? name : owner.replace(/-([^-]+)$/, '.$1');
}

export function labelFor(labels: Record<string, string>, key: string): string {
	return labels[key] ?? key;
}

// 2026-11-12T15:49:33.000Z -> 2026-11-12 15:49 UTC
export function formatTimestamp(isoText: string | null): string {
	if (!isoText) {
		return 'never';
	}

	return `${isoText.slice(0, 10)} ${isoText.slice(11, 16)} UTC`;
}
