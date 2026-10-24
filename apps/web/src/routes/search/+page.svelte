<script lang="ts">
  import { onMount } from 'svelte';
  import type { AnimePage, AnimeSummary, Facets } from '@youranimelist/shared';
  import DataTable from '$lib/components/DataTable.svelte';
  import FacetPicker from '$lib/components/FacetPicker.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { api, queryString } from '$lib/data/api';
  import { readCache, writeCache } from '$lib/data/cache';
  import { animeColumns } from '$lib/data/columns';
  import { label, listStatusTone, season } from '$lib/data/format';
  import { appState } from '$lib/state/app.svelte';

  let rows = $state<AnimeSummary[]>([]); let facets = $state<Facets | null>(null);
  let total = $state(0); let cursor = $state<string | null>(null); let loading = $state(false); let error = $state<string | null>(null); let initialized = $state(false);
  let q = $state(''); let sort = $state('score_desc'); let mediaType = $state(''); let yearFrom = $state(''); let yearTo = $state('');
  let scoreFrom = $state(''); let scoreTo = $state(''); let relatedFrom = $state(''); let relatedTo = $state('');
  let status = $state(''); let source = $state(''); let seasonFilter = $state(''); let episodesFrom = $state(''); let episodesTo = $state('');
  let genres = $state<number[]>([]); let studios = $state<number[]>([]); let request = 0; let timer: ReturnType<typeof setTimeout> | undefined;
  const columns = animeColumns();
  const userById = $derived(new Map(appState.userList.map((anime) => [anime.id, anime])));
  const signature = $derived(JSON.stringify({ q, sort, mediaType, yearFrom, yearTo, scoreFrom, scoreTo, relatedFrom, relatedTo, status, source, seasonFilter, episodesFrom, episodesTo, genres, studios }));
  const filters = (nextCursor?: string | null) => ({ q, sort, mediaType, yearFrom, yearTo, scoreFrom, scoreTo, relatedFrom, relatedTo, status, source, season: seasonFilter, episodesFrom, episodesTo, genres: genres.join(','), studios: studios.join(','), cursor: nextCursor ?? undefined, limit: 100 });

  onMount(async () => {
    try { facets = await api<Facets>('/v1/facets'); } catch { /* results can still load */ }
    const params = new URLSearchParams(location.search);
    q = params.get('q') ?? ''; sort = params.get('sort') ?? 'score_desc'; mediaType = params.get('mediaType') ?? '';
    yearFrom = params.get('yearFrom') ?? ''; yearTo = params.get('yearTo') ?? ''; scoreFrom = params.get('scoreFrom') ?? ''; scoreTo = params.get('scoreTo') ?? '';
    relatedFrom = params.get('relatedFrom') ?? ''; relatedTo = params.get('relatedTo') ?? ''; status = params.get('status') ?? ''; source = params.get('source') ?? '';
    seasonFilter = params.get('season') ?? ''; episodesFrom = params.get('episodesFrom') ?? ''; episodesTo = params.get('episodesTo') ?? '';
    genres = params.get('genres')?.split(',').map(Number).filter(Boolean) ?? []; studios = params.get('studios')?.split(',').map(Number).filter(Boolean) ?? [];
    initialized = true; await load(true);
  });

  $effect(() => {
    signature;
    if (!initialized) return;
    clearTimeout(timer);
    timer = setTimeout(() => void load(true), 280);
    return () => clearTimeout(timer);
  });

  async function load(reset: boolean) {
    if (loading && !reset) return;
    const current = ++request; const targetCursor = reset ? null : cursor;
    if (!reset && !targetCursor) return;
    loading = true; error = null;
    const params = queryString(filters(targetCursor));
    if (reset) {
      history.replaceState(null, '', `/search?${queryString({ username: appState.loadedUsername || appState.username || new URLSearchParams(location.search).get('username') || '', q, sort: sort === 'score_desc' ? '' : sort, mediaType, yearFrom, yearTo, scoreFrom, scoreTo, relatedFrom, relatedTo, status, source, season: seasonFilter, episodesFrom, episodesTo, genres: genres.join(','), studios: studios.join(',') })}`);
      const cached = await readCache<AnimePage>(`search:${params}`);
      if (cached) { rows = cached.value.items; total = cached.value.total; cursor = cached.value.nextCursor; }
    }
    try {
      const page = await api<AnimePage>(`/v1/anime?${params}`);
      if (current !== request) return;
      rows = reset ? page.items : [...rows, ...page.items.filter((item) => !rows.some((row) => row.id === item.id))];
      total = page.total; cursor = page.nextCursor;
      if (reset) await writeCache(`search:${params}`, page, 30 * 60_000, page.revision);
    } catch (cause) { if (current === request) error = cause instanceof Error ? cause.message : 'Search failed.'; }
    finally { if (current === request) loading = false; }
  }
  function reset() { q=''; sort='score_desc'; mediaType=''; yearFrom=''; yearTo=''; scoreFrom=''; scoreTo=''; relatedFrom=''; relatedTo=''; status=''; source=''; seasonFilter=''; episodesFrom=''; episodesTo=''; genres=[]; studios=[]; }
</script>
<svelte:head><title>Search DB · YourAnimeList</title></svelte:head>
<div class="page">
  <PageHeader title="Search DB" description={facets ? `${facets.counts.anime.toLocaleString()} anime · ${facets.counts.relations.toLocaleString()} relations` : 'The complete local database.'} />
  <div class="toolbar"><div class="toolbar-group"><input class="search" bind:value={q} placeholder="Title, synonym, English or Japanese…" /><select bind:value={sort}><option value="score_desc">Highest score</option><option value="score_asc">Lowest score</option><option value="popularity">Most popular</option><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="episodes_desc">Most episodes</option><option value="episode_duration_desc">Longest average episode</option><option value="episode_duration_asc">Shortest average episode</option><option value="runtime_desc">Longest runtime</option><option value="runtime_asc">Shortest runtime</option><option value="related_desc">Most related</option><option value="related_asc">Least related</option><option value="title">Title</option></select><button onclick={reset}>Reset</button></div></div>
  <div class="filters">
    <label class="filter"><span>Media type</span><select bind:value={mediaType}><option value="">Any</option>{#each facets?.mediaTypes ?? [] as item}<option value={item.value}>{label(item.value)} ({item.count})</option>{/each}</select></label>
    <label class="filter"><span>Year</span><div class="filter-row"><input bind:value={yearFrom} type="number" placeholder={String(facets?.years.min ?? 'From')} /><input bind:value={yearTo} type="number" placeholder={String(facets?.years.max ?? 'To')} /></div></label>
    <label class="filter"><span>MAL score</span><div class="filter-row"><input bind:value={scoreFrom} type="number" step=".1" placeholder="Min" /><input bind:value={scoreTo} type="number" step=".1" placeholder="Max" /></div></label>
    <label class="filter"><span>Episodes</span><div class="filter-row"><input bind:value={episodesFrom} type="number" placeholder="Min" /><input bind:value={episodesTo} type="number" placeholder="Max" /></div></label>
    <label class="filter"><span>Related entries</span><div class="filter-row"><input bind:value={relatedFrom} type="number" placeholder="Min" /><input bind:value={relatedTo} type="number" placeholder="Max" /></div></label>
    <label class="filter"><span>Season</span><select bind:value={seasonFilter}><option value="">Any</option>{#each facets?.seasons ?? [] as item}<option value={item.value}>{label(item.value)}</option>{/each}</select></label>
  </div>
  <details class="advanced"><summary>More filters</summary><div class="filters">
    <label class="filter"><span>Status</span><select bind:value={status}><option value="">Any</option>{#each facets?.statuses ?? [] as item}<option value={item.value}>{label(item.value)}</option>{/each}</select></label>
    <label class="filter"><span>Source</span><select bind:value={source}><option value="">Any</option>{#each facets?.sources ?? [] as item}<option value={item.value}>{label(item.value)}</option>{/each}</select></label>
    <FacetPicker label="Genres" options={facets?.genres ?? []} bind:value={genres} />
    <FacetPicker label="Studios" options={facets?.studios ?? []} bind:value={studios} />
  </div></details>
  {#if error}<div class="error">{error}</div>{/if}
  <DataTable {rows} {columns} rowKey={(row) => row.id} rowMeta={(row) => ({ title: row.title, subtitle: `${label(row.mediaType)} · ${season(row.season, row.year)}`, imageUrl: row.imageUrl, href: row.malUrl, imageTone: listStatusTone(userById.get(row.id)?.user.status) })} {total} {loading} hasMore={cursor !== null} loadMore={() => load(false)} />
</div>
