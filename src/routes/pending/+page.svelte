<!-- src/routes/pending/+page.svelte
	 MIT — (c) Doughmination System®
-->

<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatTimestamp, labelFor, ruleLabels } from '#lib/labels.ts';

	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let busyFindingId = $state<number | null>(null);

	function trackBusy(findingId: number) {
		return () => {
			busyFindingId = findingId;

			return async ({ update }: { update: () => Promise<void> }) => {
				await update();
				busyFindingId = null;
			};
		};
	}
</script>

<svelte:head>
	<title>Pending · is-a-tracker</title>
</svelte:head>

<h1>Pending reviews</h1>

{#if form?.outcome}
	<p class="notice {form.outcome.status}" role="status">
		{form.outcome.summary}
		{#if 'githubUrl' in form.outcome && form.outcome.githubUrl}
			<a href={form.outcome.githubUrl} target="_blank" rel="noreferrer">Open on GitHub</a>
		{/if}
	</p>
{/if}

{#if data.findings.length === 0}
	<p class="card muted">Nothing is waiting for a decision.</p>
{/if}

{#each data.findings as finding (finding.id)}
	<article class="card">
		<h2>
			<a href={finding.url} target="_blank" rel="noreferrer">#{finding.prNumber}</a>
			{finding.title}
		</h2>

		<dl>
			<dt>Violation</dt>
			<dd>{labelFor(ruleLabels, finding.ruleId)}</dd>

			<dt>Author</dt>
			<dd>{finding.author}</dd>

			<dt>File</dt>
			<dd><code>{finding.filePath}</code></dd>

			<dt>Reason</dt>
			<dd>{finding.reason}</dd>

			<dt>Detected</dt>
			<dd>{formatTimestamp(finding.createdAt)}</dd>

			{#if finding.lastOutcome}
				<dt>Last result</dt>
				<dd>{finding.lastOutcome}</dd>
			{/if}
		</dl>

		<div class="formRow">
			<form method="POST" action="?/approve" use:enhance={trackBusy(finding.id)}>
				<input type="hidden" name="findingId" value={finding.id} />
				<button
					class={finding.actionType === 'closePr' ? 'danger' : 'primary'}
					disabled={busyFindingId !== null}
				>
					{busyFindingId === finding.id ? 'Working…' : finding.actionLabel}
				</button>
			</form>

			<form method="POST" action="?/ignore" use:enhance={trackBusy(finding.id)}>
				<input type="hidden" name="findingId" value={finding.id} />
				<button disabled={busyFindingId !== null}>Ignore</button>
			</form>
		</div>
	</article>
{/each}

<style>
	dl {
		display: grid;
		grid-template-columns: 7rem 1fr;
		gap: 0.25rem 1rem;
		margin: 0 0 1rem;
	}

	dt {
		color: var(--text-secondary);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
