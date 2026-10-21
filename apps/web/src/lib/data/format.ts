import type { ListStatus, UserAnime } from '@youranimelist/shared';

export function number(value: number | null | undefined) {
  return value == null ? '—' : new Intl.NumberFormat().format(value);
}
export function decimal(value: number | null | undefined, digits = 2) {
  return value == null ? '—' : value.toFixed(digits);
}
export function label(value: string | null | undefined) {
  return value ? value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : '—';
}
export function duration(seconds: number | null | undefined) {
  if (!seconds) return '—';
  const [value, unit] = seconds >= 86400
    ? [seconds / 86400, 'd']
    : seconds >= 3600
      ? [seconds / 3600, 'h']
      : seconds >= 60
        ? [seconds / 60, 'm']
        : [seconds, 's'];
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}${unit}`;
}
export function season(seasonName: string | null, year: number | null) {
  return year ? `${seasonName ? label(seasonName) + ' ' : ''}${year}` : '—';
}
export function date(value: string | null | undefined) {
  return value?.slice(0, 10) || '—';
}
export type ListStatusTone = 'neutral' | 'good' | 'bad' | 'accent' | 'warning';

export function listStatusTone(status: ListStatus | undefined): ListStatusTone | undefined {
  if (!status) return undefined;
  return status === 'completed' ? 'good' : status === 'watching' ? 'accent' : status === 'dropped' ? 'bad' : status === 'on_hold' ? 'warning' : 'neutral';
}
export function adjustedUserScore(anime: UserAnime) {
  if (anime.user.score == null) return null;
  const tags = anime.user.tags.map((tag) => tag.toLowerCase());
  return anime.user.score + (tags.includes('plus') ? 0.25 : tags.includes('minus') ? -0.25 : 0);
}

export function userScoreLabel(anime: UserAnime) {
  if (anime.user.score == null) return '—';
  const tags = anime.user.tags.map((tag) => tag.toLowerCase());
  return `${anime.user.score}${tags.includes('plus') ? '+' : tags.includes('minus') ? '−' : ''}`;
}
