<!-- src/routes/+page.svelte
	 MIT — (c) Doughmination System®
-->

<script lang="ts">
	import ActionsChart from '#lib/components/ActionsChart.svelte';
	import { formatTimestamp } from '#lib/labels.ts';

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
	<title>Overview · is-a-tracker</title>
</svelte:head>

<h1>Overview</h1>

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

<p class="muted">
	Last scan: {formatTimestamp(data.scanner.lastScanAt)}.
	{#if data.scanner.lastError}
		Last scan problem: {data.scanner.lastError}
	{/if}
</p>

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
