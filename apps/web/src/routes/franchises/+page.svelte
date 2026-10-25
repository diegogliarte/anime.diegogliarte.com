<script lang="ts">
  import { onMount } from 'svelte';
  import type { AnimeSummary, Franchise, FranchiseScope } from '@youranimelist/shared';
  import AnimePicker from '$lib/components/AnimePicker.svelte';
  import DataTable, { type TableColumn } from '$lib/components/DataTable.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { api } from '$lib/data/api';
  import { readCache, writeCache } from '$lib/data/cache';
  import { animeColumns } from '$lib/data/columns';
  import { duration, label, listStatusTone, number, season } from '$lib/data/format';
  import { appState } from '$lib/state/app.svelte';

  let franchise = $state<Franchise | null>(null); let loading = $state(false); let error = $state<string | null>(null); let scope = $state<FranchiseScope>('expanded'); let selectedId = $state<number | null>(null);
  const userById = $derived(new Map(appState.userList.map((anime) => [anime.id, anime])));
  const edgeLabels = $derived.by(() => {
    const values = new Map<number, string[]>();
    for (const edge of franchise?.edges ?? []) {
      if (!edge.included) continue;
      for (const id of [edge.fromId, edge.toId]) values.set(id, [...new Set([...(values.get(id) ?? []), edge.label])]);
    }
    return values;
  });
  const columns = $derived<TableColumn<AnimeSummary>[]>([
    ...animeColumns().filter((column) => ['title', 'score', 'episodes', 'season', 'startDate', 'endDate', 'type', 'related', 'episodeDuration', 'runtime'].includes(column.key)),
    { key: 'relation', label: 'Relations', value: (row) => edgeLabels.get(row.id)?.join(', ') ?? (row.id === franchise?.seedId ? 'Seed' : '—'), width: '190px' }
  ]);
  const franchiseStats = $derived.by(() => {
    const nodes = franchise?.nodes ?? [];
    const completed = nodes.filter((anime) => userById.get(anime.id)?.user.status === 'completed').length;
    const withEpisodes = nodes.filter((anime) => (anime.episodes ?? 0) > 0);
    const episodes = withEpisodes.reduce((sum, anime) => sum + (anime.episodes ?? 0), 0);
    const watchedEpisodes = withEpisodes.reduce((sum, anime) => sum + Math.min(userById.get(anime.id)?.user.watchedEpisodes ?? 0, anime.episodes ?? 0), 0);
    const withDuration = withEpisodes.filter((anime) => (anime.episodeDuration ?? 0) > 0);
    const totalSeconds = withDuration.reduce((sum, anime) => sum + (anime.episodes ?? 0) * (anime.episodeDuration ?? 0), 0);
    const watchedSeconds = withDuration.reduce((sum, anime) => sum + Math.min(userById.get(anime.id)?.user.watchedEpisodes ?? 0, anime.episodes ?? 0) * (anime.episodeDuration ?? 0), 0);
    const durationEpisodes = withDuration.reduce((sum, anime) => sum + (anime.episodes ?? 0), 0);
    return { completed, entries: nodes.length, watchedEpisodes, episodes, episodeEntries: withEpisodes.length, watchedSeconds, totalSeconds, durationEntries: withDuration.length, averageEpisodeMinutes: durationEpisodes ? totalSeconds / durationEpisodes / 60 : 0, averageEpisodes: withEpisodes.length ? episodes / withEpisodes.length : 0 };
  });

  onMount(() => {
    const id = Number(new URLSearchParams(location.search).get('id')) || appState.lastFranchiseId;
    if (id) { selectedId = id; void load(id); }
  });
  $effect(() => { if (selectedId && franchise && franchise.scope !== scope) void load(selectedId); });

  async function choose(anime: AnimeSummary) {
    selectedId = anime.id; appState.setLastFranchise(anime.id);
    history.replaceState(null, '', `/franchises?id=${anime.id}`); await load(anime.id);
  }
  async function load(id: number) {
    loading = true; error = null;
    const key = `franchise:${id}:${scope}`;
    const cached = await readCache<Franchise>(key); if (cached) franchise = cached.value;
    try {
      const result = await api<Franchise>(`/v1/franchises/${id}?scope=${scope}`);
      franchise = result; appState.setLastFranchise(id); await writeCache(key, result, 7 * 24 * 60 * 60_000, result.revision);
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Unable to load franchise.'; }
    finally { loading = false; }
  }
</script>
<svelte:head><title>Franchises · YourAnimeList</title></svelte:head>
<div class="page">
  <PageHeader title="Franchises" description="A chronological inventory of connected entries."><AnimePicker onselect={choose} placeholder="Find a franchise seed…" /></PageHeader>
  <div class="toolbar"><div class="toolbar-group"><button class:primary={scope === 'core'} onclick={() => scope = 'core'}>Core</button><button class:primary={scope === 'expanded'} onclick={() => scope = 'expanded'}>Core + side stories</button><button class:primary={scope === 'all'} onclick={() => scope = 'all'}>Everything</button></div></div>
  {#if franchise}<div class="franchise-stats">
    <div><span>Completed</span><strong>{number(franchiseStats.completed)}/{number(franchiseStats.entries)}</strong><small>accepted franchise entries</small></div>
    <div><span>Episodes</span><strong>{number(franchiseStats.watchedEpisodes)}/{number(franchiseStats.episodes)}</strong><small>{number(franchiseStats.episodeEntries)} entries with episode count</small></div>
    <div><span>Time</span><strong>{duration(franchiseStats.watchedSeconds)}/{duration(franchiseStats.totalSeconds)}</strong><small>{number(franchiseStats.durationEntries)} entries with duration</small></div>
    <div><span>Avg ep duration</span><strong>{franchiseStats.averageEpisodeMinutes.toFixed(1)}m</strong><small>weighted by episode count</small></div>
    <div><span>Avg eps/anime</span><strong>{franchiseStats.averageEpisodes.toFixed(1)}</strong><small>known episode counts</small></div>
  </div>{/if}
  {#if error}<div class="error">{error}</div>{/if}
  {#if franchise}<DataTable rows={franchise.nodes} {columns} rowKey={(row) => row.id} rowMeta={(row) => { const user = userById.get(row.id); return { title: row.title, subtitle: `${label(row.mediaType)} · ${season(row.season, row.year)}`, imageUrl: row.imageUrl, href: row.malUrl, tags: user?.user.tags, imageTone: listStatusTone(user?.user.status) }; }} total={franchise.nodes.length} {loading} />
  {:else if loading}<div class="empty">Loading franchise…</div>
  {:else}<EmptyState title="Select an anime" detail="The last franchise you viewed will open automatically on your next visit." />{/if}
</div>
