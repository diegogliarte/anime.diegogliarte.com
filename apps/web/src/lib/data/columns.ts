import type { AnimeSummary, UserAnime } from '@youranimelist/shared';
import type { TableColumn } from '$lib/components/DataTable.svelte';
import { adjustedUserScore, date, decimal, duration, label, number, season, userScoreLabel } from './format';

export function animeColumns(): TableColumn<AnimeSummary>[] {
  return [
    { key: 'title', label: 'Anime', value: (row) => row.title, width: '420px', hideable: false },
    { key: 'score', label: 'MAL', value: (row) => row.score, format: (value) => decimal(value as number | null), width: '62px', align: 'center', tone: () => 'strong', defaultHidden: true },
    { key: 'episodes', label: 'Eps', value: (row) => row.episodes, format: (value) => number(value as number | null), width: '62px', align: 'right' },
    { key: 'season', label: 'Season', value: (row) => row.year ? row.year * 10 + seasonOrder(row.season) : null, format: (_value, row) => season(row.season, row.year), width: '105px' },
    { key: 'startDate', label: 'Start', value: (row) => row.startDate, format: (value) => date(value as string | null), width: '92px' },
    { key: 'endDate', label: 'End', value: (row) => row.endDate, format: (value) => date(value as string | null), width: '92px' },
    { key: 'type', label: 'Type', value: (row) => label(row.mediaType), width: '80px' },
    { key: 'related', label: 'Related', value: (row) => row.relatedCount, format: (value) => number(value as number), width: '72px', align: 'right' },
    { key: 'runtime', label: 'Runtime', value: (row) => row.totalDuration, format: (value) => duration(value as number | null), width: '92px', align: 'right' },
    { key: 'popularity', label: 'Popularity', value: (row) => row.popularity, format: (value) => value ? `#${number(value as number)}` : '—', width: '90px', align: 'right' }
  ];
}

export function userColumns(): TableColumn<UserAnime>[] {
  return [
    { key: 'title', label: 'Anime', value: (row) => row.title, width: '420px', hideable: false },
    { key: 'status', label: 'Status', value: (row) => label(row.user.status), width: '105px' },
    { key: 'userScore', label: 'Score', value: adjustedUserScore, format: (_value, row) => userScoreLabel(row), width: '62px', align: 'center', tone: () => 'strong' },
    { key: 'progress', label: 'Progress', value: (row) => row.user.watchedEpisodes, format: (_value, row) => `${number(row.user.watchedEpisodes)} / ${number(row.episodes)}`, width: '84px', align: 'right' },
    { key: 'mal', label: 'MAL', value: (row) => row.score, format: (value) => decimal(value as number | null), width: '62px', align: 'center', defaultHidden: true },
    { key: 'season', label: 'Season', value: (row) => row.year ? row.year * 10 + seasonOrder(row.season) : null, format: (_value, row) => season(row.season, row.year), width: '105px' },
    { key: 'startDate', label: 'Start', value: (row) => row.startDate, format: (value) => date(value as string | null), width: '92px' },
    { key: 'endDate', label: 'End', value: (row) => row.endDate, format: (value) => date(value as string | null), width: '92px' },
    { key: 'related', label: 'Related', value: (row) => row.relatedCount, width: '72px', align: 'right' }
  ];
}

function seasonOrder(value: string | null) {
  return value === 'winter' ? 1 : value === 'spring' ? 2 : value === 'summer' ? 3 : value === 'fall' ? 4 : 0;
}
