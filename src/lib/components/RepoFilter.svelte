<!-- src/lib/components/RepoFilter.svelte
	 MIT — (c) Doughmination System®
-->

<script lang="ts">
	import { page } from '$app/state';
	import { repoLabel } from '#lib/labels.ts';

	let { repos, current }: { repos: string[]; current: string | null } = $props();

	// Same page, with the repository filter set (or cleared for null)
	function filterHref(repo: string | null): string {
		const next = new URL(page.url.href);

		if (repo === null) {
			next.searchParams.delete('repo');
		} else {
			next.searchParams.set('repo', repo);
		}

		return `${next.pathname}${next.search}`;
	}

	const options = $derived([
		{
			repo: null,
			label: 'All'
		},
		...repos.map((repo) => ({
			repo,
			label: repoLabel(repo)
		}))
	]);
</script>

<div class="filter" role="group" aria-label="Repository filter">
	{#each options as option (option.label)}
		<a
			href={filterHref(option.repo)}
			title={option.repo ?? 'Every repository'}
			aria-current={current === option.repo ? 'true' : undefined}
		>
			{option.label}
		</a>
	{/each}
</div>

<style>
	.filter {
		display: inline-flex;
		margin-bottom: 1rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		overflow: hidden;
		background: var(--surface-card);
	}

	.filter a {
		padding: 0.2rem 0.8rem;
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 0.9rem;
	}

	.filter a[aria-current='true'] {
		background: var(--accent);
		color: var(--accent-text);
	}
</style>
