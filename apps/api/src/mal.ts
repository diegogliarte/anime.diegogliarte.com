import type { AnimeSummary, UserAnime, UserListResponse } from '@youranimelist/shared';
import { LruCache } from './cache.js';
import { db, mapAnime } from './database.js';

const MAL_API = 'https://api.myanimelist.net/v2';
const cache = new LruCache<UserListResponse>(20);
const fields = [
  'id', 'title', 'main_picture', 'alternative_titles', 'start_date', 'end_date', 'mean', 'rank',
  'popularity', 'num_list_users', 'num_favorites', 'media_type', 'status', 'num_episodes',
  'start_season', 'source', 'average_episode_duration', 'rating', 'nsfw',
  'list_status{status,score,num_episodes_watched,is_rewatching,start_date,finish_date,num_times_rewatched,tags,updated_at}'
].join(',');

type MalEdge = { node: Record<string, any>; list_status: Record<string, any> };

function fallbackSummary(node: Record<string, any>): AnimeSummary {
  const episodes = typeof node.num_episodes === 'number' ? node.num_episodes : null;
  const duration = typeof node.average_episode_duration === 'number' ? node.average_episode_duration : null;
  return {
    id: node.id, title: node.title, imageUrl: node.main_picture?.medium ?? node.main_picture?.large ?? null,
    englishTitle: node.alternative_titles?.en ?? null, japaneseTitle: node.alternative_titles?.ja ?? null,
    startDate: node.start_date ?? null, endDate: node.end_date ?? null,
    year: node.start_season?.year ?? null, season: node.start_season?.season ?? null,
    score: node.mean ?? null, rank: node.rank ?? null, popularity: node.popularity ?? null,
    listUsers: node.num_list_users ?? null, favorites: node.num_favorites ?? null,
    mediaType: node.media_type ?? null, status: node.status ?? null, episodes,
    source: node.source ?? null, episodeDuration: duration,
    totalDuration: episodes && duration ? episodes * duration : null,
    rating: node.rating ?? null, nsfw: node.nsfw ?? null, relatedCount: 0,
    malUrl: `https://myanimelist.net/anime/${node.id}`
  };
}

export async function fetchUserList(username: string): Promise<UserListResponse> {
  const key = username.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const clientId = process.env.MAL_CLIENT_ID;
  if (!clientId) throw new Error('MAL_CLIENT_ID is not configured');
  const edges: MalEdge[] = [];
  let offset = 0;
  while (true) {
    const url = new URL(`${MAL_API}/users/${encodeURIComponent(username)}/animelist`);
    url.searchParams.set('fields', fields);
    url.searchParams.set('limit', '1000');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('nsfw', 'true');
    const response = await fetch(url, { headers: { 'X-MAL-CLIENT-ID': clientId } });
    if (!response.ok) throw new Error((await response.text()) || `MAL returned ${response.status}`);
    const page = await response.json() as { data?: MalEdge[]; paging?: { next?: string } };
    edges.push(...(page.data ?? []));
    if (!page.paging?.next || (page.data?.length ?? 0) < 1000) break;
    offset += 1000;
  }
  const ids = edges.map((edge) => edge.node.id);
  const local = ids.length ? db.prepare(`SELECT a.*, (
    SELECT COUNT(*) FROM (
      SELECT related_anime_id FROM anime_related_anime WHERE anime_id = a.id
      UNION SELECT anime_id FROM anime_related_anime WHERE related_anime_id = a.id
    )
  ) AS related_count FROM anime a WHERE a.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`).all(JSON.stringify(ids)) as Record<string, unknown>[] : [];
  const localById = new Map(local.map((row) => { const anime = mapAnime(row); return [anime.id, anime]; }));
  const genreRows = ids.length ? db.prepare(`
    SELECT ag.anime_id AS animeId, g.name
    FROM anime_genre ag JOIN genre g ON g.id = ag.genre_id
    WHERE ag.anime_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
    ORDER BY g.name COLLATE NOCASE
  `).all(JSON.stringify(ids)) as { animeId: number; name: string }[] : [];
  const studioRows = ids.length ? db.prepare(`
    SELECT ast.anime_id AS animeId, s.name
    FROM anime_studio ast JOIN studio s ON s.id = ast.studio_id
    WHERE ast.anime_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
    ORDER BY s.name COLLATE NOCASE
  `).all(JSON.stringify(ids)) as { animeId: number; name: string }[] : [];
  const groupNames = (rows: { animeId: number; name: string }[]) => {
    const grouped = new Map<number, string[]>();
    for (const row of rows) grouped.set(row.animeId, [...(grouped.get(row.animeId) ?? []), row.name]);
    return grouped;
  };
  const genresById = groupNames(genreRows);
  const studiosById = groupNames(studioRows);
  const items: UserAnime[] = edges.map(({ node, list_status }) => ({
    ...(localById.get(node.id) ?? fallbackSummary(node)),
    genres: genresById.get(node.id) ?? [],
    studios: studiosById.get(node.id) ?? [],
    user: {
      status: list_status.status,
      score: list_status.score || null,
      watchedEpisodes: list_status.num_episodes_watched ?? 0,
      rewatching: Boolean(list_status.is_rewatching),
      timesRewatched: list_status.num_times_rewatched ?? 0,
      startDate: list_status.start_date ?? null,
      finishDate: list_status.finish_date ?? null,
      updatedAt: list_status.updated_at ?? null,
      tags: Array.isArray(list_status.tags) ? list_status.tags : []
    }
  }));
  const result = { username, items, fetchedAt: new Date().toISOString() };
  cache.set(key, result, 5 * 60_000);
  return result;
}
