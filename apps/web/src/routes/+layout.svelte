<script lang="ts">
  import './app.css';
  import AppShell from '$lib/components/AppShell.svelte';
  let { children }: { children: import('svelte').Snippet } = $props();
</script>
<svelte:head><title>YourAnimeList</title><meta name="description" content="A compact, data-first interface for MyAnimeList." /></svelte:head>
<AppShell>{@render children()}</AppShell>
