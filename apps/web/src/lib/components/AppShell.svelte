<script lang="ts">
  import { page } from '$app/state';
  import { appState } from '$lib/state/app.svelte';
  let { children }: { children: import('svelte').Snippet } = $props();
  let appliedUrlUsername = $state(false);
  const navigation = [
    ['List', '/list'], ['Missing', '/missing'], ['Stats', '/stats'],
    ['Search DB', '/search'], ['Franchises', '/franchises'], ['Recommendations', '/recommendations']
  ] as const;
  $effect(() => {
    if (!appState.restored || appliedUrlUsername) return;
    appliedUrlUsername = true;
    const username = page.url.searchParams.get('username')?.trim();
    if (username && username.toLocaleLowerCase() !== appState.loadedUsername.toLocaleLowerCase()) void appState.loadUser(username);
  });

  function hrefWithUsername(href: string) {
    const username = appState.loadedUsername || page.url.searchParams.get('username');
    return username ? `${href}?username=${encodeURIComponent(username)}` : href;
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const requested = appState.username.trim();
    await appState.loadUser();
    if (!requested || appState.loadedUsername.toLocaleLowerCase() !== requested.toLocaleLowerCase()) return;
    const url = new URL(location.href);
    url.searchParams.set('username', appState.loadedUsername);
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
</script>

<div class="app-shell">
  <header class="topbar">
    <a class="wordmark" href={hrefWithUsername('/list')}><span>YAL</span><strong>YourAnimeList</strong></a>
    <nav aria-label="Primary navigation">
      {#each navigation as [label, href]}
        <a class:active={page.url.pathname.startsWith(href)} href={hrefWithUsername(href)}>{label}</a>
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
