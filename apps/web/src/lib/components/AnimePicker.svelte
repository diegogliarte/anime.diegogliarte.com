<script lang="ts">
  import type { AnimePage, AnimeSummary } from '@youranimelist/shared';
  import { api, queryString } from '$lib/data/api';
  import { label, season } from '$lib/data/format';
  let { onselect, placeholder = 'Find an anime…' }: { onselect: (anime: AnimeSummary) => void; placeholder?: string } = $props();
  let query = $state('');
  let results = $state<AnimeSummary[]>([]);
  let open = $state(false);
  let loading = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function input() {
    clearTimeout(timer);
    if (query.trim().length < 2) { results = []; open = false; return; }
    timer = setTimeout(async () => {
      loading = true;
      try { results = (await api<AnimePage>(`/v1/anime?${queryString({ q: query, limit: 12, sort: 'popularity' })}`)).items; open = true; }
      finally { loading = false; }
    }, 220);
  }
  function pick(anime: AnimeSummary) { query = anime.title; open = false; onselect(anime); }
</script>
<div class="picker">
  <input bind:value={query} oninput={input} {placeholder} aria-label={placeholder} />
  {#if loading}<span class="input-note">searching</span>{/if}
  {#if open}
    <div class="picker-results">
      {#each results as anime (anime.id)}
        <button type="button" onclick={() => pick(anime)}>
          <span>{anime.title}</span><small>{label(anime.mediaType)} · {season(anime.season, anime.year)}</small>
        </button>
      {:else}<div class="picker-empty">No matches</div>{/each}
    </div>
  {/if}
</div>
