/* src/lib/labels.ts
 * MIT — (c) Doughmination System®
 */

// Display wording shared by the dashboard pages; safe to load in the browser

export const ruleLabels: Record<string, string> = {
	nsRecords: 'NS records (first-time contributor)',
	noReplyEmail: 'No-reply owner.email'
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
