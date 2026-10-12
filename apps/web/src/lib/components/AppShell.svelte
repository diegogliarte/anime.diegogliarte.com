<script lang="ts">
  import { page } from '$app/state';
  import { appState } from '$lib/state/app.svelte';
  let { children }: { children: import('svelte').Snippet } = $props();
  const navigation = [
    ['List', '/list'], ['Missing', '/missing'], ['Stats', '/stats'],
    ['Search DB', '/search'], ['Franchises', '/franchises'], ['Recommendations', '/recommendations']
  ] as const;
  function submit(event: SubmitEvent) { event.preventDefault(); void appState.loadUser(); }
</script>

<div class="app-shell">
  <header class="topbar">
    <a class="wordmark" href="/list"><span>YAL</span><strong>YourAnimeList</strong></a>
    <nav aria-label="Primary navigation">
      {#each navigation as [label, href]}
        <a class:active={page.url.pathname.startsWith(href)} {href}>{label}</a>
      {/each}
    </nav>
    <form class="user-loader" onsubmit={submit}>
      <input bind:value={appState.username} placeholder="MAL username" aria-label="MyAnimeList username" />
      <button class="primary" disabled={appState.loadingUser}>{appState.loadingUser ? 'Loading' : appState.loadedUsername ? 'Sync' : 'Load'}</button>
    </form>
  </header>
  {#if appState.userError}<div class="global-error">{appState.userError}</div>{/if}
  <main>{@render children()}</main>
</div>
