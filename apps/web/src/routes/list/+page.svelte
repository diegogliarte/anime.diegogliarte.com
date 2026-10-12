<script lang="ts">
  import type { ListStatus, UserAnime } from '@youranimelist/shared';
  import DataTable from '$lib/components/DataTable.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { userColumns } from '$lib/data/columns';
  import { label, listStatusTone, season } from '$lib/data/format';
  import { appState } from '$lib/state/app.svelte';
  let query = $state(''); let status = $state<ListStatus | 'all'>('all');
  const statuses: (ListStatus | 'all')[] = ['all', 'watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch'];
  const rows = $derived.by(() => {
    const search = query.trim().toLowerCase();
    return appState.userList.filter((anime) => (status === 'all' || anime.user.status === status) && (!search || `${anime.title} ${anime.englishTitle ?? ''} ${anime.user.tags.join(' ')}`.toLowerCase().includes(search)));
  });
  const counts = $derived(new Map(statuses.map((item) => [item, item === 'all' ? appState.userList.length : appState.userList.filter((anime) => anime.user.status === item).length])));
  const meta = (anime: UserAnime) => ({ title: anime.title, subtitle: `${label(anime.mediaType)} · ${season(anime.season, anime.year)}`, imageUrl: anime.imageUrl, href: anime.malUrl, tags: anime.user.tags, imageTone: listStatusTone(anime.user.status) });
</script>
<svelte:head><title>List · YourAnimeList</title></svelte:head>
<div class="page">
  <PageHeader title="List" description={appState.loadedUsername ? `${appState.loadedUsername} · ${appState.userList.length.toLocaleString()} entries` : 'Your complete MyAnimeList, without the noise.'} />
  {#if appState.userList.length}
    <div class="toolbar"><div class="toolbar-group"><input class="search" bind:value={query} placeholder="Filter title or tag…" />{#each statuses as item}<button class:primary={status === item} onclick={() => status = item}>{label(item)} <small>{counts.get(item)}</small></button>{/each}</div></div>
    <DataTable rows={rows} columns={userColumns()} rowKey={(row) => row.id} rowMeta={meta} total={rows.length} />
  {:else if appState.loadingUser}<div class="empty">Loading your list…</div>
  {:else}<EmptyState title="Load a MyAnimeList username" detail="Your list is cached on this device after the first sync." />{/if}
</div>
