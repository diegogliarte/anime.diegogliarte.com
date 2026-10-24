<script lang="ts">
  import type { UserAnime } from '@youranimelist/shared';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { appState } from '$lib/state/app.svelte';
  import { adjustedUserScore, decimal, duration, label, number, userScoreLabel } from '$lib/data/format';

  type BreakdownMetric = 'count' | 'mean' | 'weighted';
  type Group = { name: string; count: number; items: UserAnime[]; ratedCount: number; meanScore: number; weightedScore: number };
  type Ranked = { anime: UserAnime; value: string };
  type Stat = { label: string; value: string; hint: string; missing?: UserAnime[] };
  type FunStat = { label: string; value: string; hint: string; items?: UserAnime[]; itemValue?: (anime: UserAnime) => string };

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
  const decided = $derived([...completed, ...dropped]);
  const knownStarted = $derived(appState.userList.filter((anime) => anime.user.status !== 'plan_to_watch' && (anime.episodes ?? 0) > 0));
  const knownEpisodeProgress = $derived(knownStarted.reduce((sum, anime) => sum + Math.min(anime.user.watchedEpisodes, anime.episodes ?? 0), 0));
  const knownEpisodeTotal = $derived(knownStarted.reduce((sum, anime) => sum + (anime.episodes ?? 0), 0));
  const medianScore = $derived(median(rated.map((anime) => adjustedUserScore(anime) ?? 0)));
  const meanAbsoluteDifference = $derived(average(comparable.map((anime) => Math.abs(scoreDifference(anime)))));
  const perfectScores = $derived(rated.filter((anime) => anime.user.score === 10));
  const oneSitting = $derived(completed.filter((anime) => {
    const runtime = (anime.episodes ?? 0) * (anime.episodeDuration ?? 0);
    return runtime > 0 && runtime <= 3 * 60 * 60;
  }));
  const pacedCompletions = $derived(completed
    .filter((anime) => completionDays(anime) != null)
    .sort((a, b) => (completionDays(b) ?? 0) - (completionDays(a) ?? 0)));
  const medianCompletionDays = $derived(median(pacedCompletions.map((anime) => completionDays(anime) ?? 0)));
  const medianDropPoint = $derived(median(dropped.map((anime) => anime.user.watchedEpisodes)));
  const plannedWithRuntime = $derived(planned.filter((anime) => anime.episodes && anime.episodeDuration));
  const plannedSeconds = $derived(plannedWithRuntime.reduce((sum, anime) => sum + (anime.episodes ?? 0) * (anime.episodeDuration ?? 0), 0));
  const completedYears = $derived(completed.map((anime) => anime.year).filter((year): year is number => year != null).sort((a, b) => a - b));
  let breakdownMetric = $state<BreakdownMetric>('count');

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
    { label: 'Finish-date coverage', value: percent(completed.length - missingFinishDate.length, completed.length), hint: `${number(missingFinishDate.length)} missing · click to inspect`, missing: missingFinishDate },
    { label: 'Median score', value: decimal(medianScore, 2), hint: 'less distorted by score extremes' },
    { label: 'MAL disagreement', value: decimal(meanAbsoluteDifference, 2), hint: 'mean absolute score difference' },
    { label: 'Finish rate', value: percent(completed.length, decided.length), hint: `${number(completed.length)} completed vs ${number(dropped.length)} dropped` },
    { label: 'Episode completion', value: percent(knownEpisodeProgress, knownEpisodeTotal), hint: `${number(knownEpisodeProgress)} / ${number(knownEpisodeTotal)} known started episodes` }
  ]);

  const funStats = $derived<FunStat[]>([
    { label: 'Perfect-score rate', value: percent(perfectScores.length, rated.length), hint: `${number(perfectScores.length)} of ${number(rated.length)} completed ratings are 10/10`, items: perfectScores },
    { label: 'Median drop point', value: dropped.length ? `${decimal(medianDropPoint, 1)} eps` : '—', hint: `${number(dropped.length)} dropped titles`, items: dropped, itemValue: (anime) => `${number(anime.user.watchedEpisodes)} eps` },
    { label: 'Short-form finishes', value: number(oneSitting.length), hint: 'completed total runtime of 3 hours or less', items: oneSitting, itemValue: (anime) => duration((anime.episodes ?? 0) * (anime.episodeDuration ?? 0)) },
    { label: 'Median completion time', value: pacedCompletions.length ? `${decimal(medianCompletionDays, 1)} days` : '—', hint: `${number(pacedCompletions.length)} titles with valid start and finish dates`, items: pacedCompletions, itemValue: (anime) => `${number(completionDays(anime))} days` },
    { label: 'Backlog runtime', value: duration(plannedSeconds), hint: plannedSeconds ? `${number(Math.ceil(plannedSeconds / 7200))} days at 2 hours/day · ${number(plannedWithRuntime.length)} known runtimes` : 'no known planned runtime' },
    { label: 'Release-year range', value: completedYears.length ? `${number(completedYears.at(-1)! - completedYears[0])} years` : '—', hint: completedYears.length ? `${completedYears[0]} to ${completedYears.at(-1)}` : 'no known release years' }
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
    { title: 'Top genres', rows: rankGroups(groupMany(completed, (anime) => anime.genres), breakdownMetric).slice(0, 10), scorable: true },
    { title: 'Top studios', rows: rankGroups(groupMany(completed, (anime) => anime.studios), breakdownMetric).slice(0, 10), scorable: true }
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
  function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : 0; }
  function deviation(values: number[]) { const mean = average(values); return values.length ? Math.sqrt(average(values.map((value) => (value - mean) ** 2))) : 0; }
  function percent(value: number, total: number) { return total ? `${decimal(value / total * 100, 1)}%` : '—'; }
  function signed(value: number) { return `${value >= 0 ? '+' : ''}${decimal(value, 2)}`; }
  function scoreDifference(anime: UserAnime) { return (adjustedUserScore(anime) ?? 0) - (anime.score ?? 0); }
  function completionDays(anime: UserAnime) {
    if (!anime.user.startDate || !anime.user.finishDate) return null;
    const start = Date.parse(anime.user.startDate); const finish = Date.parse(anime.user.finishDate);
    if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return null;
    return Math.round((finish - start) / 86_400_000);
  }
  function group(items: UserAnime[], key: (anime: UserAnime) => string): Group[] {
    const groups = new Map<string, UserAnime[]>();
    for (const anime of items) { const name = key(anime); groups.set(name, [...(groups.get(name) ?? []), anime]); }
    return [...groups].map(([name, grouped]) => makeGroup(name, grouped)).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  function groupMany(items: UserAnime[], keys: (anime: UserAnime) => string[] | undefined): Group[] {
    const groups = new Map<string, UserAnime[]>();
    for (const anime of items) for (const name of keys(anime) ?? []) groups.set(name, [...(groups.get(name) ?? []), anime]);
    return [...groups].map(([name, grouped]) => makeGroup(name, grouped)).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  function makeGroup(name: string, items: UserAnime[]): Group {
    const scores = items.map(adjustedUserScore).filter((score): score is number => score != null);
    const groupMean = average(scores);
    const priorWeight = 5;
    return { name, count: items.length, items, ratedCount: scores.length, meanScore: groupMean, weightedScore: scores.length ? (scores.reduce((sum, score) => sum + score, 0) + meanScore * priorWeight) / (scores.length + priorWeight) : 0 };
  }
  function rankGroups(groups: Group[], metric: BreakdownMetric) {
    const value = (group: Group) => metric === 'count' ? group.count : metric === 'mean' ? group.meanScore : group.weightedScore;
    return [...groups].sort((a, b) => value(b) - value(a) || b.ratedCount - a.ratedCount || a.name.localeCompare(b.name));
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
    <section class="taste-profile">
      <div class="section-heading"><h2>Viewing profile</h2><span>Literal habits derived from your list.</span></div>
      <div class="stats-grid taste-grid">
        {#each funStats as stat (stat.label)}
          {#if stat.items?.length}
            <details class="stat stat-expandable"><summary><span>{stat.label}</span><strong>{stat.value}</strong><small>{stat.hint}</small></summary><div class="stat-missing">{#each stat.items as anime (anime.id)}<a href={anime.malUrl} target="_blank"><span>{anime.title}</span>{#if stat.itemValue}<small>{stat.itemValue(anime)}</small>{/if}</a>{/each}</div></details>
          {:else}<div class="stat"><span>{stat.label}</span><strong>{stat.value}</strong><small>{stat.hint}</small></div>{/if}
        {/each}
      </div>
    </section>
    <div class="breakdowns">
      {#each breakdowns as breakdown (breakdown.title)}{@render Breakdown(breakdown.title, breakdown.rows, breakdown.scorable ?? false)}{/each}
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
    <p class="stats-note">Plus and minus tags adjust scores by ±0.25. Watch time includes completed rewatches and uses MAL episode duration where available. Weighted rankings pull each group toward your overall mean by a five-rating prior, preventing tiny groups from dominating.</p>
  {:else}<EmptyState title="Load your list first" detail="Statistics are calculated locally and remain available offline." />{/if}
</div>

{#snippet Breakdown(title: string, rows: Group[], scorable: boolean)}
  {@const maximum = scorable && breakdownMetric !== 'count' ? 10 : Math.max(...rows.map((row) => row.count), 1)}
  <section class="breakdown"><div class="breakdown-heading"><h2>{title}</h2>{#if scorable}<div class="metric-toggle" aria-label={`${title} ranking metric`}>{#each [['count', 'Count'], ['mean', 'Mean'], ['weighted', 'Weighted']] as option}<button class:active={breakdownMetric === option[0]} onclick={() => breakdownMetric = option[0] as BreakdownMetric}>{option[1]}</button>{/each}</div>{/if}</div>{#each rows as row (row.name)}{@const metricValue = breakdownMetric === 'count' || !scorable ? row.count : breakdownMetric === 'mean' ? row.meanScore : row.weightedScore}<details class="breakdown-row"><summary class="bar-row"><span>{row.name}</span><div class="bar"><i style:width={`${metricValue / maximum * 100}%`}></i></div><code>{scorable && breakdownMetric !== 'count' ? (row.ratedCount ? decimal(metricValue, 2) : '—') : number(row.count)}</code></summary><div class="breakdown-items">{#each row.items as anime (anime.id)}<a href={anime.malUrl} target="_blank">{anime.title}</a>{/each}</div></details>{/each}</section>
{/snippet}

{#snippet Showcase(title: string, description: string, rows: UserAnime[], metric: 'mal' | 'popularity')}
  <section class="showcase"><h2>{title}</h2><p>{description}</p><div class="showcase-list">{#each rows as anime (anime.id)}<a href={anime.malUrl} target="_blank">{#if anime.imageUrl}<img class="status-image status-good" src={anime.imageUrl} alt="" loading="lazy" />{:else}<span class="showcase-cover-empty"></span>{/if}<div><strong>{anime.title}</strong><span>you {userScoreLabel(anime)}</span></div><b class:negative={scoreDifference(anime) < 0}>{signed(scoreDifference(anime))}</b><small>{metric === 'mal' ? `MAL ${decimal(anime.score, 2)}` : `pop #${number(anime.popularity)}`}</small></a>{/each}</div></section>
{/snippet}

{#snippet Ranking(title: string, rows: Ranked[])}
  <section class="ranking"><h2>{title}</h2>{#each rows as row, index (row.anime.id)}<a href={row.anime.malUrl} target="_blank"><code>{String(index + 1).padStart(2, '0')}</code><span>{row.anime.title}</span><strong>{row.value}</strong></a>{/each}</section>
{/snippet}
