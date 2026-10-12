<script lang="ts">
  import type { UserAnime } from '@youranimelist/shared';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { appState } from '$lib/state/app.svelte';
  import { adjustedUserScore, decimal, duration, label, number, userScoreLabel } from '$lib/data/format';

  type Group = { name: string; count: number; items: UserAnime[] };
  type Ranked = { anime: UserAnime; value: string };
  type Stat = { label: string; value: string; hint: string; missing?: UserAnime[] };

  const completed = $derived(appState.userList.filter((anime) => anime.user.status === 'completed'));
  const planned = $derived(appState.userList.filter((anime) => anime.user.status === 'plan_to_watch'));
  const dropped = $derived(appState.userList.filter((anime) => anime.user.status === 'dropped'));
  const inProgress = $derived(appState.userList.filter((anime) => anime.user.status === 'watching' || anime.user.status === 'on_hold'));
  const rated = $derived(completed.filter((anime) => adjustedUserScore(anime) != null));
  const unrated = $derived(completed.filter((anime) => adjustedUserScore(anime) == null));
  const comparable = $derived(rated.filter((anime) => anime.score != null));
  const uniqueEpisodes = $derived(appState.userList.reduce((sum, anime) => sum + anime.user.watchedEpisodes, 0));
  const rewatchEpisodes = $derived(appState.userList.reduce((sum, anime) => sum + anime.user.timesRewatched * (anime.episodes ?? 0), 0));
  const watchedEpisodes = $derived(uniqueEpisodes + rewatchEpisodes);
  const watchedSeconds = $derived(appState.userList.reduce((sum, anime) => sum + (anime.user.watchedEpisodes + anime.user.timesRewatched * (anime.episodes ?? 0)) * (anime.episodeDuration ?? 0), 0));
  const rewatchSeconds = $derived(appState.userList.reduce((sum, anime) => sum + anime.user.timesRewatched * (anime.episodes ?? 0) * (anime.episodeDuration ?? 0), 0));
  const meanScore = $derived(average(rated.map((anime) => adjustedUserScore(anime) ?? 0)));
  const scoreSpread = $derived(deviation(rated.map((anime) => adjustedUserScore(anime) ?? 0)));
  const versusMal = $derived(average(comparable.map((anime) => (adjustedUserScore(anime) ?? 0) - (anime.score ?? 0))));
  const runtimeCoverage = $derived(completed.filter((anime) => anime.episodeDuration).length);
  const missingRuntime = $derived(completed.filter((anime) => !anime.episodeDuration));
  const totalRewatches = $derived(appState.userList.reduce((sum, anime) => sum + anime.user.timesRewatched, 0));
  const remainingEpisodes = $derived(inProgress.reduce((sum, anime) => sum + Math.max((anime.episodes ?? anime.user.watchedEpisodes) - anime.user.watchedEpisodes, 0), 0));
  const plannedEpisodes = $derived(planned.reduce((sum, anime) => sum + (anime.episodes ?? 0), 0));
  const incompleteCompleted = $derived(completed.filter((anime) => anime.episodes && anime.user.watchedEpisodes < anime.episodes));
  const missingFinishDate = $derived(completed.filter((anime) => !anime.user.finishDate));

  const stats = $derived<Stat[]>([
    { label: 'Completed', value: number(completed.length), hint: `${number(appState.userList.length)} total entries` },
    { label: 'Episodes watched', value: number(watchedEpisodes), hint: `${number(rewatchEpisodes)} from rewatches` },
    { label: 'Watch time', value: duration(watchedSeconds), hint: `${duration(rewatchSeconds)} rewatched` },
    { label: 'Mean score', value: decimal(meanScore, 2), hint: `${number(rated.length)} completed rated` },
    { label: 'Completion', value: percent(completed.length, appState.userList.length), hint: `${number(planned.length)} planned` },
    { label: 'Dropped', value: number(dropped.length), hint: percent(dropped.length, appState.userList.length) },
    { label: 'Rated coverage', value: percent(rated.length, completed.length), hint: `${number(unrated.length)} missing · click to inspect`, missing: unrated },
    { label: 'Score spread', value: decimal(scoreSpread, 2), hint: 'standard deviation' },
    { label: 'Vs MAL mean', value: signed(versusMal), hint: `${number(comparable.length)} comparable` },
    { label: 'Avg episodes', value: decimal(average(completed.map((anime) => anime.user.watchedEpisodes)), 1), hint: 'per completed entry' },
    { label: 'Runtime coverage', value: percent(runtimeCoverage, completed.length), hint: `${number(missingRuntime.length)} missing · click to inspect`, missing: missingRuntime },
    { label: 'Rewatches', value: number(totalRewatches), hint: `${number(appState.userList.filter((anime) => anime.user.timesRewatched > 0).length)} titles` },
    { label: 'Backlog', value: number(planned.length), hint: `${number(plannedEpisodes)} known episodes` },
    { label: 'In progress', value: number(inProgress.length), hint: `${number(remainingEpisodes)} known episodes remaining` },
    { label: 'Episode integrity', value: percent(completed.length - incompleteCompleted.length, completed.length), hint: `${number(incompleteCompleted.length)} incomplete · click to inspect`, missing: incompleteCompleted },
    { label: 'Finish-date coverage', value: percent(completed.length - missingFinishDate.length, completed.length), hint: `${number(missingFinishDate.length)} missing · click to inspect`, missing: missingFinishDate }
  ]);

  const breakdowns = $derived([
    { title: 'Status', rows: group(appState.userList, (anime) => label(anime.user.status)) },
    { title: 'Scores', rows: group(rated, userScoreLabel).sort((a, b) => parseFloat(b.name) - parseFloat(a.name)) },
    { title: 'Completed media', rows: group(completed, (anime) => label(anime.mediaType)) },
    { title: 'Completed source', rows: group(completed, (anime) => label(anime.source)).slice(0, 10) },
    { title: 'Completed decades', rows: group(completed, (anime) => anime.year ? `${Math.floor(anime.year / 10) * 10}s` : 'Unknown').sort((a, b) => b.name.localeCompare(a.name)) },
    { title: 'Completed seasons', rows: group(completed, (anime) => label(anime.season)) },
    { title: 'Top release years', rows: group(completed, (anime) => anime.year ? String(anime.year) : 'Unknown').slice(0, 12) },
    { title: 'Episode length', rows: group(completed, episodeBucket) },
    { title: 'Top genres', rows: groupMany(completed, (anime) => anime.genres).slice(0, 10) },
    { title: 'Top studios', rows: groupMany(completed, (anime) => anime.studios).slice(0, 10) }
  ]);

  const longest = $derived<Ranked[]>(completed
    .map((anime) => ({ anime, seconds: anime.user.watchedEpisodes * (anime.episodeDuration ?? 0) }))
    .filter((item) => item.seconds > 0).sort((a, b) => b.seconds - a.seconds).slice(0, 10)
    .map((item) => ({ anime: item.anime, value: duration(item.seconds) })));
  const rewatches = $derived<Ranked[]>(appState.userList.filter((anime) => anime.user.timesRewatched > 0)
    .sort((a, b) => b.user.timesRewatched - a.user.timesRewatched).slice(0, 10)
    .map((anime) => ({ anime, value: `${anime.user.timesRewatched}×` })));
  const hiddenGems = $derived(comparable.filter((anime) => (adjustedUserScore(anime) ?? 0) >= 8 && (anime.score ?? 0) < 7.9)
    .sort((a, b) => scoreDifference(b) - scoreDifference(a)).slice(0, 8)
  );
  const hotTakes = $derived(comparable.filter((anime) => (anime.score ?? 0) >= 8 && scoreDifference(anime) < 0)
    .sort((a, b) => scoreDifference(a) - scoreDifference(b)).slice(0, 8));
  const mostObscure = $derived(rated.filter((anime) => (adjustedUserScore(anime) ?? 0) >= 8 && (anime.popularity ?? 0) > 0)
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)).slice(0, 8));
  const popularMisses = $derived(rated.filter((anime) => (adjustedUserScore(anime) ?? 0) <= 6 && (anime.popularity ?? 0) > 0)
    .sort((a, b) => (a.popularity ?? Infinity) - (b.popularity ?? Infinity)).slice(0, 8));

  function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
  function deviation(values: number[]) { const mean = average(values); return values.length ? Math.sqrt(average(values.map((value) => (value - mean) ** 2))) : 0; }
  function percent(value: number, total: number) { return total ? `${decimal(value / total * 100, 1)}%` : '—'; }
  function signed(value: number) { return `${value >= 0 ? '+' : ''}${decimal(value, 2)}`; }
  function scoreDifference(anime: UserAnime) { return (adjustedUserScore(anime) ?? 0) - (anime.score ?? 0); }
  function group(items: UserAnime[], key: (anime: UserAnime) => string): Group[] {
    const groups = new Map<string, UserAnime[]>();
    for (const anime of items) { const name = key(anime); groups.set(name, [...(groups.get(name) ?? []), anime]); }
    return [...groups].map(([name, grouped]) => ({ name, count: grouped.length, items: grouped })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  function groupMany(items: UserAnime[], keys: (anime: UserAnime) => string[] | undefined): Group[] {
    const groups = new Map<string, UserAnime[]>();
    for (const anime of items) for (const name of keys(anime) ?? []) groups.set(name, [...(groups.get(name) ?? []), anime]);
    return [...groups].map(([name, grouped]) => ({ name, count: grouped.length, items: grouped })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  function episodeBucket(anime: UserAnime) {
    const episodes = anime.episodes ?? 0;
    if (!episodes) return 'Unknown'; if (episodes === 1) return '1'; if (episodes <= 6) return '2–6';
    if (episodes <= 13) return '7–13'; if (episodes <= 26) return '14–26'; if (episodes <= 52) return '27–52';
    if (episodes <= 99) return '53–99'; return '100+';
  }
</script>

<svelte:head><title>Stats · YourAnimeList</title></svelte:head>
<div class="page">
  <PageHeader title="Stats" description={appState.loadedUsername ? `${appState.loadedUsername}'s list, measured.` : 'Your list, measured.'} />
  {#if appState.userList.length}
    <div class="stats-grid">
      {#each stats as stat (stat.label)}
        {#if stat.missing}
          <details class="stat stat-expandable"><summary><span>{stat.label}</span><strong>{stat.value}</strong><small>{stat.hint}</small></summary><div class="stat-missing">{#each stat.missing as anime (anime.id)}<a href={anime.malUrl} target="_blank">{anime.title}</a>{/each}</div></details>
        {:else}<div class="stat"><span>{stat.label}</span><strong>{stat.value}</strong><small>{stat.hint}</small></div>{/if}
      {/each}
    </div>
    <div class="breakdowns">
      {#each breakdowns as breakdown (breakdown.title)}{@render Breakdown(breakdown.title, breakdown.rows)}{/each}
    </div>
    <div class="insights-grid">
      {@render Ranking('Longest completed', longest)}
      {@render Ranking('Most rewatched', rewatches)}
    </div>
    <div class="showcases-grid">
      {@render Showcase('Hidden gems', 'Completed anime you rated 8+, with MAL mean below 7.9.', hiddenGems, 'mal')}
      {@render Showcase('Hot takes', 'MAL mean is 8.0+, but your score is lower.', hotTakes, 'mal')}
      {@render Showcase('Most obscure', 'Completed anime you rated 8+, sorted by popularity rank.', mostObscure, 'popularity')}
      {@render Showcase('Popular misses', 'Popular completed anime you scored 6 or lower.', popularMisses, 'popularity')}
    </div>
    <p class="stats-note">Plus and minus tags adjust scores by ±0.25. Watch time includes completed rewatches and uses MAL episode duration where available.</p>
  {:else}<EmptyState title="Load your list first" detail="Statistics are calculated locally and remain available offline." />{/if}
</div>

{#snippet Breakdown(title: string, rows: Group[])}
  {@const maximum = Math.max(...rows.map((row) => row.count), 1)}
  <section class="breakdown"><h2>{title}</h2>{#each rows as row (row.name)}<details class="breakdown-row"><summary class="bar-row"><span>{row.name}</span><div class="bar"><i style:width={`${row.count / maximum * 100}%`}></i></div><code>{number(row.count)}</code></summary><div class="breakdown-items">{#each row.items as anime (anime.id)}<a href={anime.malUrl} target="_blank">{anime.title}</a>{/each}</div></details>{/each}</section>
{/snippet}

{#snippet Showcase(title: string, description: string, rows: UserAnime[], metric: 'mal' | 'popularity')}
  <section class="showcase"><h2>{title}</h2><p>{description}</p><div class="showcase-list">{#each rows as anime (anime.id)}<a href={anime.malUrl} target="_blank">{#if anime.imageUrl}<img class="status-image status-good" src={anime.imageUrl} alt="" loading="lazy" />{:else}<span class="showcase-cover-empty"></span>{/if}<div><strong>{anime.title}</strong><span>you {userScoreLabel(anime)}</span></div><b class:negative={scoreDifference(anime) < 0}>{signed(scoreDifference(anime))}</b><small>{metric === 'mal' ? `MAL ${decimal(anime.score, 2)}` : `pop #${number(anime.popularity)}`}</small></a>{/each}</div></section>
{/snippet}

{#snippet Ranking(title: string, rows: Ranked[])}
  <section class="ranking"><h2>{title}</h2>{#each rows as row, index (row.anime.id)}<a href={row.anime.malUrl} target="_blank"><code>{String(index + 1).padStart(2, '0')}</code><span>{row.anime.title}</span><strong>{row.value}</strong></a>{/each}</section>
{/snippet}
