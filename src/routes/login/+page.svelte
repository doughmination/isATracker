<!-- src/routes/login/+page.svelte
	 MIT — (c) Doughmination System®
-->

<script lang="ts">
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head>
	<title>Sign in · is-a-tracker</title>
</svelte:head>

<h1>is-a-tracker</h1>

{#if form?.problem}
	<p class="notice failure" role="alert">{form.problem}</p>
{/if}

<form method="POST" class="card formRow">
	<input
		type="password"
		name="password"
		placeholder="Dashboard password"
		aria-label="Dashboard password"
		autocomplete="current-password"
		required
	/>
	<button class="primary">Sign in</button>
</form>
