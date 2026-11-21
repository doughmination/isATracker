<!-- src/routes/+page.svelte
	 MIT — (c) Doughmination System®
-->

<script lang="ts">
	import ActionsChart from '#lib/components/ActionsChart.svelte';
	import RepoFilter from '#lib/components/RepoFilter.svelte';
	import { formatTimestamp, repoLabel } from '#lib/labels.ts';

	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const tiles = $derived([
		{
			label: 'PRs closed',
			value: data.stats.closedTotal
		},
		{
			label: 'NS closures',
			value: data.stats.nsClosures
		},
		{
			label: 'Changes requested',
			value: data.stats.reviewsTotal
		},
		{
			label: 'Pending items',
			value: data.stats.pendingTotal
		}
	]);
</script>

<svelte:head>
	<title>Overview · isATracker</title>
</svelte:head>

<h1>Moderation overview</h1>

<p class="muted">
	Public statistics for pull request moderation across the tracked repositories. Action totals cover
	all time; the chart shows the last 30 days. Pending items are individual findings, so one pull
	request can have several.
</p>

<RepoFilter repos={data.repos} current={data.repoFilter} />

<section class="tiles">
	{#each tiles as tile (tile.label)}
		<div class="card tile">
			<span class="muted">{tile.label}</span>
			<strong>{tile.value}</strong>
		</div>
	{/each}
</section>

<section class="card">
	<h2>Moderation actions, last 30 days</h2>
	<ActionsChart daily={data.stats.daily} />
</section>

{#each data.scanners as scanner (scanner.repo)}
	<p class="muted">
		{repoLabel(scanner.repo)}: last scan {formatTimestamp(scanner.lastScanAt)}.
		{#if scanner.lastError}
			Last scan problem: {scanner.lastError}
		{:else if scanner.hasError}
			The scanner is experiencing a problem.
		{/if}
	</p>
{/each}

<style>
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 1rem;
	}

	.tile {
		display: flex;
		flex-direction: column;
		margin-bottom: 0;
	}

	.tile strong {
		font-size: 2.1rem;
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
	}

	.tiles {
		margin-bottom: 1rem;
	}
</style>
