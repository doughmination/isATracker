<!-- src/routes/+layout.svelte
	 MIT — (c) Doughmination System®
-->

<script lang="ts">
	import '../app.css';

	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';

	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const links = [
		{
			href: '/',
			label: 'Overview'
		},
		{
			href: '/pending',
			label: 'Pending'
		},
		{
			href: '/history',
			label: 'History'
		},
		{
			href: '/lookup',
			label: 'Lookup'
		}
	];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if data.showNavigation}
	<header>
		<nav class="page">
			<strong>is-a-tracker</strong>

			{#each links as link (link.href)}
				<a href={link.href} aria-current={page.url.pathname === link.href ? 'page' : undefined}>
					{link.label}
					{#if link.href === '/pending' && data.pendingTotal > 0}
						<span class="count">{data.pendingTotal}</span>
					{/if}
				</a>
			{/each}

			<span class="spacer"></span>

			{#if data.dryRun}
				<span class="pill" title="Buttons will not change anything on GitHub">Dry run ON</span>
			{/if}

			{#if data.canSignOut}
				<form method="POST" action="/logout">
					<button>Sign out</button>
				</form>
			{/if}
		</nav>
	</header>
{/if}

<main class="page">
	{@render children()}
</main>

<style>
	header {
		background: var(--surface-card);
		border-bottom: 1px solid var(--border);
	}

	nav {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1.1rem;
		padding-top: 0.7rem;
		padding-bottom: 0.7rem;
	}

	nav a {
		color: var(--text-secondary);
		text-decoration: none;
		padding: 0.15rem 0;
		border-bottom: 2px solid transparent;
	}

	nav a[aria-current='page'] {
		color: var(--text-primary);
		border-bottom-color: var(--accent);
	}

	.count {
		margin-left: 0.2rem;
		padding: 0 0.45rem;
		border-radius: 999px;
		background: var(--accent);
		color: var(--accent-text);
		font-size: 0.8rem;
	}

	.spacer {
		flex: 1;
	}
</style>
