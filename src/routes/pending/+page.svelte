<!-- src/routes/pending/+page.svelte
	 MIT — (c) Doughmination System®
-->

<script lang="ts">
	import { enhance } from '$app/forms';
	import RepoFilter from '#lib/components/RepoFilter.svelte';
	import { formatTimestamp, labelFor, repoLabel, ruleLabels, severityLabels } from '#lib/labels.ts';

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
	<title>Pending · isATracker</title>
</svelte:head>

<h1>Pending reviews</h1>

<RepoFilter repos={data.repos} current={data.repoFilter} />

{#if form?.outcome}
	<p class="notice {form.outcome.status}" role="status">
		{form.outcome.summary}
		{#if 'githubUrl' in form.outcome && form.outcome.githubUrl}
			<a href={form.outcome.githubUrl} target="_blank" rel="noreferrer">Open on GitHub</a>
		{/if}
	</p>
{/if}

{#if data.pullRequests.length === 0}
	<p class="card muted">Nothing is waiting for a decision.</p>
{/if}

{#each data.pullRequests as pullRequest (pullRequest.key)}
	<article class="card">
		<h2>
			<a href={pullRequest.url} target="_blank" rel="noreferrer">
				{repoLabel(pullRequest.repo)} #{pullRequest.prNumber}
			</a>
			{pullRequest.title}
		</h2>

		<p class="muted">By {pullRequest.author}</p>

		{#each pullRequest.violations as violation (violation.id)}
			<dl>
				<dt>Violation</dt>
				<dd>
					{labelFor(ruleLabels, violation.ruleId)}
					<span class="muted">({severityLabels[violation.severity]})</span>
				</dd>

				<dt>File</dt>
				<dd><code>{violation.filePath}</code></dd>

				<dt>Reason</dt>
				<dd>{violation.reason}</dd>

				<dt>Detected</dt>
				<dd>{formatTimestamp(violation.createdAt)}</dd>
			</dl>
		{/each}

		{#if pullRequest.lastOutcome}
			<p class="muted">Last result: {pullRequest.lastOutcome}</p>
		{/if}

		{#if pullRequest.actionFindingId !== null}
			{@const findingId = pullRequest.actionFindingId}

			<div class="formRow">
				<form method="POST" action="?/approve" use:enhance={trackBusy(findingId)}>
					<input type="hidden" name="findingId" value={findingId} />
					<button
						class={pullRequest.actionType === 'closePr' ? 'danger' : 'primary'}
						disabled={busyFindingId !== null}
					>
						{busyFindingId === findingId ? 'Working…' : pullRequest.actionLabel}
					</button>
				</form>

				<form method="POST" action="?/ignore" use:enhance={trackBusy(findingId)}>
					<input type="hidden" name="findingId" value={findingId} />
					<button disabled={busyFindingId !== null}>{pullRequest.ignoreLabel}</button>
				</form>
			</div>
		{:else}
			<p class="muted">Working…</p>
		{/if}
	</article>
{/each}

<style>
	dl {
		display: grid;
		grid-template-columns: 7rem 1fr;
		gap: 0.25rem 1rem;
		margin: 0 0 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}

	dt {
		color: var(--text-secondary);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
