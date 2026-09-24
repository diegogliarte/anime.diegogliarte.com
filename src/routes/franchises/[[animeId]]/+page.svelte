<script lang="ts">
	import { goto } from '$app/navigation';
	import AnimeSearchPanel from '$lib/components/anime/AnimeSearchPanel.svelte';
	import FranchiseGraph from '$lib/components/franchise/FranchiseGraph.svelte';
	import AnimeTable, { type AnimeTableAnime } from '$lib/components/ui/AnimeTable.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Panel from '$lib/components/ui/Panel.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import { animeData } from '$lib/stores/anime-data.svelte';
	import type { AnimeDetails, AnimeListStatusName, UserAnimeListEdge } from '$lib/types/anime';
	import { compareAnimeRelease, formatSeason, getAnimeUrl } from '$lib/utils/anime.utils';
	import { formatDecimal, formatDuration, formatNumber } from '$lib/utils/format.utils';
	import type { PageProps } from './$types';

	type Stat = {
		label: string;
		value: string | number;
		hint?: string;
	};

	type PlacementCandidate = {
		host: AnimeDetails;
		afterEpisode: number;
		beforeEpisode: number | null;
		spanDays: number;
	};

	let { params }: PageProps = $props();

	let autoAccept = $state(false);
	let franchiseView = $state<'list' | 'graph'>('list');
	let pendingCollapsed = $state(false);
	let routeStartedAnimeId = $state<number | null>(null);
	let lastRouteAnimeId = $state<number | null | undefined>(undefined);

	const autoAcceptingAnimeIds = new Set<number>();

	const routeAnimeId = $derived.by(() => {
		const raw = params.animeId;

		if (!raw || !/^\d+$/.test(raw)) return null;

		return Number(raw);
	});

	$effect(() => {
		const animeId = routeAnimeId;

		if (lastRouteAnimeId === animeId) return;

		lastRouteAnimeId = animeId;

		if (!animeId) {
			routeStartedAnimeId = null;
			franchiseView = 'list';
			pendingCollapsed = false;
			animeData.clearFranchise();
			animeData.clearFranchiseSearch();
			return;
		}

		if (routeStartedAnimeId === animeId) return;

		routeStartedAnimeId = animeId;

		void startFranchiseFromRoute(animeId);
	});

	$effect(() => {
		if (!autoAccept) return;

		for (const candidate of animeData.franchisePendingList) {
			if (autoAcceptingAnimeIds.has(candidate.animeId)) continue;

			autoAcceptingAnimeIds.add(candidate.animeId);

			void animeData.acceptFranchiseCandidate(candidate.animeId).finally(() => {
				autoAcceptingAnimeIds.delete(candidate.animeId);
			});
		}
	});

	const userEntryByAnimeId = $derived.by(() => {
		const entries = new Map<number, UserAnimeListEdge>();

		for (const entry of animeData.userList) {
			entries.set(entry.node.id, entry);
		}

		return entries;
	});

	const franchisePendingIds = $derived.by(() => {
		return animeData.franchisePendingCandidates.map((candidate) => candidate.animeId);
	});

	const franchiseGraphAnimeList = $derived.by(() => {
		const ids = new Set<number>([...animeData.franchiseAcceptedIds, ...franchisePendingIds]);

		return [...ids]
			.map((id) => animeData.franchiseAnimeById[id])
			.filter((anime): anime is AnimeDetails => Boolean(anime))
			.sort((a, b) => compareAnimeRelease({ node: a }, { node: b }));
	});

	const franchiseWatchHints = $derived.by(() => {
		return getFranchiseWatchHints(animeData.franchiseAnimeList);
	});

	const franchiseStats = $derived.by<Stat[]>(() => {
		const entries = animeData.franchiseAnimeList;

		const completedCount = entries.filter(
			(anime) => getUserStatus(anime.id) === 'completed'
		).length;

		const knownEpisodeEntries = entries.filter((anime) => (anime.num_episodes ?? 0) > 0);
		const totalEpisodes = knownEpisodeEntries.reduce(
			(total, anime) => total + (anime.num_episodes ?? 0),
			0
		);

		const watchedEpisodes = entries.reduce((total, anime) => {
			return total + (getUserEntry(anime.id)?.list_status?.num_episodes_watched ?? 0);
		}, 0);

		const entriesWithDuration = entries.filter((anime) => {
			return (anime.average_episode_duration ?? 0) > 0 && (anime.num_episodes ?? 0) > 0;
		});

		const totalSeconds = entriesWithDuration.reduce((total, anime) => {
			return total + (anime.num_episodes ?? 0) * (anime.average_episode_duration ?? 0);
		}, 0);

		const watchedSeconds = entriesWithDuration.reduce((total, anime) => {
			const watched = getUserEntry(anime.id)?.list_status?.num_episodes_watched ?? 0;
			const duration = anime.average_episode_duration ?? 0;

			return total + watched * duration;
		}, 0);

		const averageEpisodeDuration =
			totalEpisodes > 0 && totalSeconds > 0 ? totalSeconds / totalEpisodes : 0;

		const averageEpisodesPerAnime =
			knownEpisodeEntries.length > 0 ? totalEpisodes / knownEpisodeEntries.length : 0;

		return [
			{
				label: 'Completed',
				value: `${formatNumber(completedCount)}/${formatNumber(entries.length)}`,
				hint: 'accepted franchise entries'
			},
			{
				label: 'Episodes',
				value: `${formatNumber(watchedEpisodes)}/${formatNumber(totalEpisodes)}`,
				hint: `${formatNumber(knownEpisodeEntries.length)} entries with episode count`
			},
			{
				label: 'Time',
				value: `${formatDuration(watchedSeconds)}/${formatDuration(totalSeconds)}`,
				hint: `${formatNumber(entriesWithDuration.length)} entries with duration`
			},
			{
				label: 'Avg ep duration',
				value: formatDuration(averageEpisodeDuration),
				hint: 'weighted by episode count'
			},
			{
				label: 'Avg eps/anime',
				value: formatDecimal(averageEpisodesPerAnime, 1),
				hint: 'known episode counts'
			}
		];
	});

	async function startFranchiseFromRoute(animeId: number) {
		if (animeData.franchiseSeedId === animeId && animeData.hasFranchise) return;

		animeData.clearFranchise();
		animeData.clearFranchiseSearch();
		franchiseView = 'list';

		await animeData.startFranchise(animeId);
	}

	function submitSearch() {
		void animeData.searchFranchiseAnime();
	}

	async function selectSearchResult(animeId: number) {
		if (animeData.hasFranchise) {
			await animeData.addAnimeToFranchise(animeId);
			animeData.clearFranchiseSearch();
			return;
		}

		await animeData.startFranchise(animeId);

		routeStartedAnimeId = animeId;
		lastRouteAnimeId = animeId;
		animeData.clearFranchiseSearch();

		void goto(`/franchises/${animeId}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	function startNewSearch() {
		animeData.clearFranchise();
		animeData.clearFranchiseSearch();
		franchiseView = 'list';
		pendingCollapsed = false;
		routeStartedAnimeId = null;
		lastRouteAnimeId = null;

		void goto('/franchises', {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	function getUserEntry(animeId: number) {
		return userEntryByAnimeId.get(animeId);
	}

	function getUserStatus(animeId: number): AnimeListStatusName | null {
		return getUserEntry(animeId)?.list_status?.status ?? null;
	}

	function getSubtitle(anime: AnimeDetails) {
		return [
			anime.media_type ?? 'unknown',
			formatSeason({ node: anime }),
			getEpisodeText(anime),
			getAverageEpisodeDurationText(anime),
			getTotalDurationText(anime),
			getWatchHintForAnime(anime.id)
		]
			.filter(Boolean)
			.join(' · ');
	}

	function getEpisodeText(anime: AnimeDetails) {
		return anime.num_episodes > 0 ? `${formatNumber(anime.num_episodes)} eps` : '';
	}

	function getAverageEpisodeDurationText(anime: AnimeDetails) {
		const duration = anime.average_episode_duration ?? 0;

		if (duration <= 0) return '';

		return `${formatDuration(duration)}/ep`;
	}

	function getTotalDurationText(anime: AnimeDetails) {
		const totalSeconds = getTotalSeconds(anime);

		return totalSeconds > 0 ? `${formatDuration(totalSeconds)} total` : '';
	}

	function getTotalSeconds(anime: AnimeDetails) {
		const episodes = anime.num_episodes ?? 0;
		const duration = anime.average_episode_duration ?? 0;

		if (episodes <= 0 || duration <= 0) return 0;

		return episodes * duration;
	}

	function getWatchHintForTableItem(item: AnimeTableAnime) {
		const id = getTableAnimeId(item);

		return id ? getWatchHintForAnime(id) : null;
	}

	function getWatchHintForAnime(animeId: number) {
		return franchiseWatchHints.get(animeId) ?? null;
	}

	function getTableAnimeId(item: AnimeTableAnime) {
		if ('node' in item) return item.node.id;

		return item.id;
	}

	function getFranchiseWatchHints(entries: AnimeDetails[]) {
		const hints = new Map<number, string>();

		for (const anime of entries) {
			if (!shouldEstimateWatchPlacement(anime)) continue;

			const placement = findWatchPlacement(anime, entries);

			if (placement) {
				hints.set(anime.id, placement);
			}
		}

		return hints;
	}

	function shouldEstimateWatchPlacement(anime: AnimeDetails) {
		return ['movie', 'special', 'tv_special', 'ova', 'ona', 'cm', 'music'].includes(
			anime.media_type ?? ''
		);
	}

	function findWatchPlacement(target: AnimeDetails, entries: AnimeDetails[]) {
		const targetStartDate = parseExactAnimeDate(target.start_date);

		if (!targetStartDate) return null;

		const targetEndDate = parseExactAnimeDate(target.end_date) ?? targetStartDate;

		const candidates = entries
			.filter((host) => {
				if (host.id === target.id) return false;

				return areDirectlyRelatedAnime(target.id, host.id);
			})
			.map((host) => getPlacementCandidate(targetStartDate, targetEndDate, host))
			.filter((candidate): candidate is PlacementCandidate => Boolean(candidate))
			.sort((a, b) => {
				const priorityDifference = getHostPriority(a.host) - getHostPriority(b.host);

				if (priorityDifference !== 0) return priorityDifference;

				return a.spanDays - b.spanDays;
			});

		const best = candidates[0];

		if (!best) return null;

		if (best.beforeEpisode) {
			return `Watch between eps ${best.afterEpisode}–${best.beforeEpisode} of ${best.host.title}`;
		}

		return `Watch after ep ${best.afterEpisode} of ${best.host.title}`;
	}

	function areDirectlyRelatedAnime(firstAnimeId: number, secondAnimeId: number) {
		return animeData.franchiseRelations.some((relation) => {
			return (
				(relation.fromId === firstAnimeId && relation.toId === secondAnimeId) ||
				(relation.fromId === secondAnimeId && relation.toId === firstAnimeId)
			);
		});
	}

	function getPlacementCandidate(
		targetStartDate: Date,
		targetEndDate: Date,
		host: AnimeDetails
	): PlacementCandidate | null {
		const episodes = host.num_episodes ?? 0;

		if (episodes <= 1) return null;

		const hostStartDate = parseExactAnimeDate(host.start_date);
		const hostEndDate = parseExactAnimeDate(host.end_date);

		if (!hostStartDate || !hostEndDate) return null;
		if (targetStartDate < hostStartDate || targetStartDate > hostEndDate) return null;

		const spanDays = daysBetween(hostStartDate, hostEndDate);

		if (spanDays <= 0) return null;

		const episodeGapDays = spanDays / Math.max(episodes - 1, 1);

		const startEpisode = getEstimatedEpisodeAtDate(
			targetStartDate,
			hostStartDate,
			episodeGapDays,
			episodes
		);

		const endEpisode = getEstimatedEpisodeAtDate(
			targetEndDate,
			hostStartDate,
			episodeGapDays,
			episodes
		);

		const afterEpisode = Math.min(startEpisode, endEpisode);
		const lastEpisode = Math.max(startEpisode, endEpisode);
		const beforeEpisode = lastEpisode < episodes ? lastEpisode + 1 : null;

		return {
			host,
			afterEpisode,
			beforeEpisode,
			spanDays
		};
	}

	function getEstimatedEpisodeAtDate(
		date: Date,
		hostStartDate: Date,
		episodeGapDays: number,
		totalEpisodes: number
	) {
		const elapsedDays = daysBetween(hostStartDate, date);

		return clamp(Math.floor(elapsedDays / episodeGapDays) + 1, 1, totalEpisodes);
	}

	function getHostPriority(anime: AnimeDetails) {
		if (anime.media_type === 'tv') return 0;
		if (anime.media_type === 'ona') return 1;
		if (anime.media_type === 'ova') return 2;

		return 3;
	}

	function parseExactAnimeDate(value?: string | null) {
		if (!value) return null;

		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

		if (!match) return null;

		const [, year, month, day] = match;

		return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	}

	function daysBetween(start: Date, end: Date) {
		const millisecondsPerDay = 24 * 60 * 60 * 1000;

		return Math.round((end.getTime() - start.getTime()) / millisecondsPerDay);
	}

	function clamp(value: number, min: number, max: number) {
		return Math.min(Math.max(value, min), max);
	}
</script>

<AnimeSearchPanel
	title="Franchises"
	bind:query={animeData.franchiseQuery}
	results={animeData.franchiseSearchResults}
	loading={animeData.franchiseSearchLoading}
	error={animeData.franchiseSearchError}
	disabled={false}
	selectDisabled={animeData.franchiseCrawling}
	resultsTitle={animeData.hasFranchise ? 'Add to franchise' : 'Search results'}
	emptyText="Search for an anime, then select one result to crawl its franchise."
	showEmpty={!animeData.hasFranchise}
	onSearch={submitSearch}
	onSelect={selectSearchResult}
>
	{#snippet actions()}
		{#if animeData.hasFranchise}
			<Button type="button" onclick={startNewSearch}>New franchise</Button>

			{#if animeData.franchiseCrawling}
				<Button type="button" onclick={() => animeData.stopFranchiseCrawl()}>Stop crawl</Button>
			{/if}

			<div class="flex items-center gap-1">
				<Button
					type="button"
					variant={franchiseView === 'list' ? 'primary' : 'default'}
					onclick={() => (franchiseView = 'list')}
				>
					List
				</Button>

				<Button
					type="button"
					variant={franchiseView === 'graph' ? 'primary' : 'default'}
					onclick={() => (franchiseView = 'graph')}
				>
					Graph
				</Button>
			</div>

			<Toggle bind:checked={autoAccept} label="Auto accept" />
		{/if}
	{/snippet}

	{#snippet children()}
		{#if animeData.hasFranchise}
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
				{#each franchiseStats as stat (stat.label)}
					<StatCard label={stat.label} value={stat.value} hint={stat.hint} />
				{/each}
			</div>
		{/if}

		{#if animeData.franchisePendingList.length > 0}
			<Panel
				title={`Pending relations (${animeData.franchisePendingList.length})`}
				collapsible
				bind:collapsed={pendingCollapsed}
			>
				<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
					{#each animeData.franchisePendingList as candidate (candidate.animeId)}
						<div class="rounded-md border border-border bg-surface p-2">
							<div class="flex gap-3">
								{#if candidate.imageUrl}
									<img
										src={candidate.imageUrl}
										alt={candidate.title}
										class="size-12 shrink-0 rounded-md object-cover"
									/>
								{:else}
									<div class="size-12 shrink-0 rounded-md bg-surface-soft"></div>
								{/if}

								<div class="min-w-0 flex-1">
									<a
										href={getAnimeUrl(candidate.animeId)}
										target="_blank"
										rel="noreferrer"
										class="block truncate text-sm font-medium text-text hover:text-primary"
									>
										{candidate.title}
									</a>

									<p class="mt-1 text-xs text-text-muted">
										{candidate.relationLabel}
									</p>

									{#if animeData.franchiseAnimeById[candidate.fromId]}
										<p class="mt-1 truncate text-xs text-text-muted">
											from {animeData.franchiseAnimeById[candidate.fromId].title}
										</p>
									{/if}
								</div>
							</div>

							<div class="mt-2 flex gap-2">
								<Button
									type="button"
									variant="primary"
									onclick={() => animeData.acceptFranchiseCandidate(candidate.animeId)}
								>
									Accept
								</Button>

								<Button
									type="button"
									onclick={() => animeData.rejectFranchiseCandidate(candidate.animeId)}
								>
									Reject
								</Button>
							</div>
						</div>
					{/each}
				</div>
			</Panel>
		{/if}

		{#if animeData.hasFranchise}
			{#if franchiseView === 'graph'}
				<FranchiseGraph
					animes={franchiseGraphAnimeList}
					relations={animeData.franchiseRelations}
					seedId={animeData.franchiseSeedId}
					pendingIds={franchisePendingIds}
					{getUserStatus}
					{getSubtitle}
				/>
			{:else}
				<AnimeTable
					items={animeData.franchiseAnimeList}
					filterPlaceholder="Filter franchise..."
					getSubtitleExtra={getWatchHintForTableItem}
					showFranchiseLink={false}
				/>
			{/if}
		{/if}
	{/snippet}
</AnimeSearchPanel>
