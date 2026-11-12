<!-- src/routes/history/+page.svelte
	 MIT — (c) Doughmination System®
-->

<script lang="ts">
	import {
		actionLabels,
		formatTimestamp,
		labelFor,
		ruleLabels,
		statusLabels
	} from '#lib/labels.ts';

	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>History · is-a-tracker</title>
</svelte:head>

<h1>Moderation history</h1>

<form method="GET" class="formRow card">
	<input
		type="search"
		name="q"
		value={data.searchText}
		placeholder="PR number, contributor, rule, action or status"
		aria-label="Search history"
	/>
	<button class="primary">Search</button>
</form>

{#if data.actions.length === 0}
	<p class="card muted">No matching actions.</p>
{:else}
	<div class="card tableScroll">
		<table>
			<thead>
				<tr>
					<th>PR</th>
					<th>Contributor</th>
					<th>Violation</th>
					<th>Action</th>
					<th>When</th>
					<th>Result</th>
				</tr>
			</thead>
			<tbody>
				{#each data.actions as action (action.id)}
					<tr>
						<td>
							<a
								href={action.githubUrl ?? `${data.repoUrl}/pull/${action.prNumber}`}
								target="_blank"
								rel="noreferrer"
							>
								#{action.prNumber}
							</a>
						</td>
						<td>{action.contributor}</td>
						<td>{labelFor(ruleLabels, action.ruleId)}</td>
						<td>
							{labelFor(actionLabels, action.actionType)}
							<span class="muted">via {action.source}</span>
						</td>
						<td>{formatTimestamp(action.createdAt)}</td>
						<td>
							<span class="pill {action.status}" title={action.detail}>
								{labelFor(statusLabels, action.status)}
							</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
