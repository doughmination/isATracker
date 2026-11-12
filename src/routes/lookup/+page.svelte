<!-- src/routes/lookup/+page.svelte
	 MIT — (c) Doughmination System®
-->

<script lang="ts">
	import { labelFor, ruleLabels } from '#lib/labels.ts';

	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Lookup · is-a-tracker</title>
</svelte:head>

<h1>Manual PR lookup</h1>

<form method="GET" class="formRow card">
	<input
		type="text"
		name="pr"
		value={data.query}
		placeholder="PR number or GitHub pull request URL"
		aria-label="Pull request"
	/>
	<button class="primary">Check</button>
</form>

{#if data.problem}
	<p class="notice failure" role="alert">{data.problem}</p>
{/if}

{#if data.result}
	{@const result = data.result}

	<section class="card">
		<h2>
			<a href={result.pullRequest.url} target="_blank" rel="noreferrer">
				#{result.pullRequest.number}
			</a>
			{result.pullRequest.title}
		</h2>

		<p class="muted">
			By {result.pullRequest.author} ({result.pullRequest.authorAssociation}) ·
			{result.pullRequest.state} · commit <code>{result.pullRequest.headSha.slice(0, 7)}</code>
		</p>

		{#if result.violations.length === 0}
			<p class="notice success">No violations found.</p>
		{:else}
			{#each result.violations as violation (violation.ruleId + violation.filePath)}
				<div class="notice failure">
					<strong>{labelFor(ruleLabels, violation.ruleId)}</strong>
					<br />
					<code>{violation.filePath}</code>
					<br />
					{violation.reason}
				</div>
			{/each}
		{/if}

		<h2>Files inspected</h2>

		{#if result.inspectedFiles.length === 0}
			<p class="muted">This PR changes no registration files under <code>domains/</code>.</p>
		{:else}
			<ul>
				{#each result.inspectedFiles as file (file.path)}
					<li>
						<code>{file.path}</code>
						{#if !file.validJson}
							<span class="pill failure">Invalid JSON</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if result.skippedFileCount > 0}
			<p class="muted">{result.skippedFileCount} more file(s) were over the per-PR limit.</p>
		{/if}
	</section>
{/if}
