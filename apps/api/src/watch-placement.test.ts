import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnimeSummary, FranchiseEdge } from '@youranimelist/shared';
import { inferWatchPlacements } from './watch-placement.js';

function anime(overrides: Partial<AnimeSummary> & Pick<AnimeSummary, 'id' | 'title'>): AnimeSummary {
  return {
    imageUrl: null,
    englishTitle: null,
    japaneseTitle: null,
    startDate: null,
    endDate: null,
    year: null,
    season: null,
    score: null,
    rank: null,
    popularity: null,
    listUsers: null,
    favorites: null,
    mediaType: null,
    status: null,
    episodes: null,
    source: null,
    episodeDuration: null,
    totalDuration: null,
    rating: null,
    nsfw: null,
    relatedCount: 0,
    malUrl: `https://myanimelist.net/anime/${overrides.id}`,
    ...overrides
  };
}

function relation(fromId: number, toId: number, code: string): FranchiseEdge {
  return { fromId, toId, relation: code, label: code, included: true };
}

test('places a related movie between estimated episodes inside an airing window', () => {
  const series = anime({ id: 1, title: 'Series', mediaType: 'tv', episodes: 6, startDate: '2026-01-01', endDate: '2026-02-05' });
  const movie = anime({ id: 2, title: 'Movie', mediaType: 'movie', episodes: 1, startDate: '2026-01-18', endDate: '2026-01-18' });
  const placements = inferWatchPlacements([series, movie], [relation(2, 1, 'parent_story')]);

  assert.deepEqual(placements.get(2), {
    anchorAnimeId: 1,
    anchorTitle: 'Series',
    afterEpisode: 3,
    beforeEpisode: 4,
    basis: 'release_date'
  });
});

test('places a sequel movie after its directly related completed entry', () => {
  const series = anime({ id: 1, title: 'Series', mediaType: 'tv', episodes: 6, startDate: '2026-01-01', endDate: '2026-02-05' });
  const movie = anime({ id: 2, title: 'Movie', mediaType: 'movie', episodes: 1, startDate: '2026-03-01', endDate: '2026-03-01' });
  const placements = inferWatchPlacements([series, movie], [relation(2, 1, 'prequel')]);

  assert.equal(placements.get(2)?.afterEpisode, 6);
  assert.equal(placements.get(2)?.basis, 'relation');
});

test('does not invent a placement without a direct franchise relation', () => {
  const series = anime({ id: 1, title: 'Series', mediaType: 'tv', episodes: 6, startDate: '2026-01-01', endDate: '2026-02-05' });
  const movie = anime({ id: 2, title: 'Movie', mediaType: 'movie', episodes: 1, startDate: '2026-01-18', endDate: '2026-01-18' });

  assert.equal(inferWatchPlacements([series, movie], []).size, 0);
});
