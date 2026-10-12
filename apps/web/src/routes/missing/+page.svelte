<script lang="ts">
  import { onMount } from 'svelte';
  import type { MissingAnime } from '@youranimelist/shared';
  import DataTable, { type TableColumn } from '$lib/components/DataTable.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { api } from '$lib/data/api';
  import { animeColumns } from '$lib/data/columns';
  import { label, season } from '$lib/data/format';
  import { readCache, writeCache } from '$lib/data/cache';
  import { appState } from '$lib/state/app.svelte';
  let rows = $state<MissingAnime[]>([]); let loading = $state(false); let error = $state<string | null>(null); let loadedFor = $state('');
  const columns = $derived<TableColumn<MissingAnime>[]>([
    ...animeColumns(),
    { key: 'sources', label: 'Related from', value: (row) => row.missingSources.length, format: (_value, row) => row.missingSources.slice(0, 2).map((source) => `${source.title} (${source.label})`).join(', '), width: '300px', sortable: false }
  ]);
  $effect(() => { if (appState.loadedUsername && loadedFor !== appState.loadedUsername) void load(); });
  onMount(() => { if (appState.loadedUsername) void load(); });
  async function load() {
    const username = appState.loadedUsername; if (!username || loading) return;
    loadedFor = username; loading = true; error = null;
    const key = `missing:${username.toLowerCase()}`;
    const cached = await readCache<{ items: MissingAnime[] }>(key); if (cached) rows = cached.value.items;
    try {
      const ids = appState.userList.filter((anime) => anime.user.status === 'completed').map((anime) => anime.id);
      const result = await api<{ items: MissingAnime[]; revision: string }>('/v1/missing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ animeIds: ids }) });
      rows = result.items; await writeCache(key, result, 6 * 60 * 60_000, result.revision);
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Unable to calculate missing entries.'; } finally { loading = false; }
  }
</script>
<svelte:head><title>Missing · YourAnimeList</title></svelte:head>
<div class="page">
  <PageHeader title="Missing" description="Unlisted anime directly connected to something you completed.">{#if appState.userList.length}<button onclick={load}>Refresh</button>{/if}</PageHeader>
  {#if error}<div class="error">{error}</div>{/if}
  {#if rows.length}<DataTable {rows} {columns} rowKey={(row) => row.id} rowMeta={(row) => ({ title: row.title, subtitle: `${label(row.mediaType)} · ${season(row.season, row.year)}`, imageUrl: row.imageUrl, href: row.malUrl })} total={rows.length} {loading} />
  {:else if loading}<div class="empty">Calculating missing entries…</div>
  {:else}<EmptyState title={appState.userList.length ? 'Nothing missing' : 'Load your list first'} detail={appState.userList.length ? 'No directly related unlisted entries were found.' : undefined} />{/if}
</div>
