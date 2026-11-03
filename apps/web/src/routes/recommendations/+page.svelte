<script lang="ts">
  import { onMount } from 'svelte';
  import type { AnimeSummary, Recommendation, RecommendationResponse } from '@youranimelist/shared';
  import AnimePicker from '$lib/components/AnimePicker.svelte';
  import DataTable, { type TableColumn } from '$lib/components/DataTable.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { api } from '$lib/data/api';
  import { readCache, writeCache } from '$lib/data/cache';
  import { animeColumns } from '$lib/data/columns';
  import { decimal, label, listStatusTone, number, season } from '$lib/data/format';
  import { appState } from '$lib/state/app.svelte';
  type RecommendationRow = AnimeSummary & Partial<Pick<Recommendation, 'recommendationScore' | 'recommendationCount' | 'sourceCount' | 'reasons'>>;
  let result = $state<RecommendationResponse | null>(null); let loading = $state(false); let error = $state<string | null>(null);
  const userById = $derived(new Map(appState.userList.map((anime) => [anime.id, anime])));
  const rows = $derived(result ? [result.seed, ...result.items] : []);
  const columns: TableColumn<RecommendationRow>[] = [
    animeColumns()[0] as TableColumn<RecommendationRow>,
    { key: 'recommendationScore', label: 'Relevance', value: (row) => row.recommendationScore ?? null, format: (value) => value == null ? '—' : decimal(value as number), width: '85px', align: 'right', tone: (row) => row.recommendationScore == null ? 'default' : 'strong' },
    { key: 'sources', label: 'Sources', value: (row) => row.sourceCount ?? null, format: (value) => value == null ? '—' : number(value as number), width: '70px', align: 'right' },
    { key: 'votes', label: 'Direct votes', value: (row) => row.recommendationCount ?? null, format: (value) => value == null ? '—' : number(value as number), width: '90px', align: 'right' },
    ...animeColumns().filter((column) => ['score', 'episodes', 'season', 'startDate', 'endDate', 'type', 'related', 'episodeDuration', 'runtime'].includes(column.key)) as TableColumn<RecommendationRow>[],
    { key: 'why', label: 'Why', value: (row) => row.reasons?.join(' · ') ?? null, width: '320px', sortable: false }
  ];
  onMount(() => { const id = Number(new URLSearchParams(location.search).get('id')); if (id) void load(id); });
  async function choose(anime: AnimeSummary) { history.replaceState(null, '', `/recommendations?id=${anime.id}`); await load(anime.id); }
  async function load(id: number) {
    loading = true; error = null; const key = `recommendations:v3:${id}`;
    const cached = await readCache<RecommendationResponse>(key); if (cached) result = cached.value;
    try { const response = await api<RecommendationResponse>(`/v1/recommendations/${id}`); result = response; await writeCache(key, response, 24 * 60 * 60_000, response.revision); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Unable to load recommendations.'; }
    finally { loading = false; }
  }
</script>
<svelte:head><title>Recommendations · YourAnimeList</title></svelte:head>
<div class="page">
  <PageHeader title="Recommendations" description={result ? `Signals extending outward from ${result.seed.title}.` : 'Recommendations ranked by strength and independent sources.'}><AnimePicker onselect={choose} placeholder="Choose a starting anime…" /></PageHeader>
  {#if error}<div class="error">{error}</div>{/if}
  {#if result}<DataTable {rows} {columns} rowKey={(row) => row.id} rowMeta={(row) => ({ title: row.title, subtitle: `${label(row.mediaType)} · ${season(row.season, row.year)}`, imageUrl: row.imageUrl, href: row.malUrl, imageTone: listStatusTone(userById.get(row.id)?.user.status) })} total={rows.length} {loading} />
  {:else if loading}<div class="empty">Calculating recommendations…</div>
  {:else}<EmptyState title="Select an anime" detail="Results expose both recommendation strength and the paths supporting it." />{/if}
</div>
