import type { AnimeSummary, FranchiseEdge, WatchPlacement } from '@youranimelist/shared';

const SERIES_MEDIA = new Set(['tv', 'ona']);

const INVERSE_RELATION: Record<string, string> = {
  prequel: 'sequel',
  sequel: 'prequel',
  parent_story: 'side_story',
  side_story: 'parent_story',
  full_story: 'summary',
  summary: 'full_story'
};

const RELATION_SCORE: Record<string, number> = {
  parent_story: 90,
  prequel: 85,
  full_story: 75,
  side_story: 55,
  sequel: 45,
  alternative_version: 35,
  alternative_setting: 30,
  spin_off: 25,
  other: 10
};

function timestamp(date: string | null) {
  if (!date) return null;
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(value) ? value : null;
}

function relationFrom(edge: FranchiseEdge, animeId: number) {
  return edge.fromId === animeId ? edge.relation : (INVERSE_RELATION[edge.relation] ?? edge.relation);
}

function isInsertable(anime: AnimeSummary) {
  return anime.mediaType === 'movie' && timestamp(anime.startDate) !== null;
}

function episodePlacement(anchor: AnimeSummary, releaseTime: number): WatchPlacement | null {
  const start = timestamp(anchor.startDate);
  const end = timestamp(anchor.endDate);
  const episodes = anchor.episodes ?? 0;
  if (start === null || end === null || episodes < 2 || releaseTime < start || releaseTime > end || end <= start) return null;

  // MAL has series-level dates rather than individual air dates. Distribute the
  // known episode count across that window, then use the preceding episode as
  // the release-order insertion point. This also handles hiatuses without
  // assuming that every show aired on an exact seven-day cadence.
  const interval = (end - start) / (episodes - 1);
  const afterEpisode = Math.min(episodes - 1, Math.max(1, Math.floor((releaseTime - start) / interval) + 1));
  return {
    anchorAnimeId: anchor.id,
    anchorTitle: anchor.title,
    afterEpisode,
    beforeEpisode: afterEpisode + 1,
    basis: 'release_date'
  };
}

export function inferWatchPlacements(nodes: AnimeSummary[], edges: FranchiseEdge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const placements = new Map<number, WatchPlacement>();

  for (const anime of nodes) {
    if (!isInsertable(anime)) continue;
    const releaseTime = timestamp(anime.startDate);
    if (releaseTime === null) continue;

    const candidates = edges.flatMap((edge) => {
      if (!edge.included || (edge.fromId !== anime.id && edge.toId !== anime.id)) return [];
      const anchorId = edge.fromId === anime.id ? edge.toId : edge.fromId;
      const anchor = nodeById.get(anchorId);
      const anchorStart = timestamp(anchor?.startDate ?? null);
      if (!anchor || anchorStart === null || anchorStart > releaseTime || anchor.id === anime.id) return [];
      const anchorEnd = timestamp(anchor.endDate) ?? anchorStart;
      const overlaps = anchorStart <= releaseTime && releaseTime <= anchorEnd && (anchor.episodes ?? 0) > 1;
      const relation = relationFrom(edge, anime.id);
      const distanceDays = Math.max(0, releaseTime - anchorEnd) / 86_400_000;
      const score = (RELATION_SCORE[relation] ?? 0)
        + (overlaps ? 160 : 0)
        + (anchor.mediaType && SERIES_MEDIA.has(anchor.mediaType) ? 30 : 0)
        - Math.min(distanceDays / 365, 20);
      return [{ anchor, overlaps, score }];
    }).sort((first, second) => second.score - first.score);

    const best = candidates[0];
    if (!best) continue;
    const withinSeries = best.overlaps ? episodePlacement(best.anchor, releaseTime) : null;
    if (withinSeries) {
      placements.set(anime.id, withinSeries);
      continue;
    }

    placements.set(anime.id, {
      anchorAnimeId: best.anchor.id,
      anchorTitle: best.anchor.title,
      afterEpisode: (best.anchor.episodes ?? 0) > 1 ? best.anchor.episodes : null,
      beforeEpisode: null,
      basis: 'relation'
    });
  }

  return placements;
}
