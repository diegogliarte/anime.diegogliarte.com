<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import type { CrawlerState, CrawlerStatusResponse } from '@youranimelist/shared';
  import { api } from '$lib/data/api';
  import { appState } from '$lib/state/app.svelte';
  let { children }: { children: import('svelte').Snippet } = $props();
  let appliedUrlUsername = $state(false);
  let crawlerState = $state<CrawlerState>('unavailable');
  const navigation = [
    ['List', '/list'], ['Missing', '/missing'], ['Stats', '/stats'],
    ['Franchises', '/franchises'], ['Recommendations', '/recommendations'], ['Search DB', '/search']
  ] as const;
  onMount(() => {
    async function refreshCrawler() {
      try { crawlerState = (await api<CrawlerStatusResponse>('/v1/crawler?logs=0')).status.state; }
      catch { crawlerState = 'unavailable'; }
    }
    void refreshCrawler();
    const timer = setInterval(() => void refreshCrawler(), 60_000);
    return () => clearInterval(timer);
  });
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
    <div class="brand"><a class="wordmark" href={hrefWithUsername('/list')}><span>YAL</span><strong>YourAnimeList</strong></a><a class="crawler-dot {crawlerState}" href="/maintenance" title="Crawler: {crawlerState}" aria-label="Crawler status"></a></div>
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
