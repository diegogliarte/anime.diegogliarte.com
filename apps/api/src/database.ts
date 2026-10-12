import Database from 'better-sqlite3';
import type { AnimeSummary, FranchiseEdge, FranchiseScope } from '@youranimelist/shared';

const sqlitePath = process.env.SQLITE_PATH ?? 'mal_anime.sqlite';
export const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
db.pragma('foreign_keys = ON');

type Raw = Record<string, unknown>;

export const RELATED_COUNT_SQL = `(
  SELECT COUNT(*) FROM (
    SELECT ara.related_anime_id AS neighbor_id
    FROM anime_related_anime ara WHERE ara.anime_id = a.id
    UNION
    SELECT ara.anime_id AS neighbor_id
    FROM anime_related_anime ara WHERE ara.related_anime_id = a.id
  ) connected
)`;

export const ANIME_SELECT = `
  a.id, a.title,
  a.main_picture_medium, a.main_picture_large,
  a.alt_title_en, a.alt_title_ja,
  a.start_date, a.end_date,
  a.start_season_year, a.start_season_season,
  a.mean, a.rank, a.popularity,
  a.num_list_users, a.num_favorites,
  a.media_type, a.status, a.num_episodes,
  a.source, a.average_episode_duration,
  a.rating, a.nsfw,
  ${RELATED_COUNT_SQL} AS related_count
`;

function string(row: Raw, key: string) {
  const value = row[key];
  return typeof value === 'string' && value.length ? value : null;
}

function number(row: Raw, key: string) {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function mapAnime(row: Raw): AnimeSummary {
  const id = number(row, 'id') ?? 0;
  const episodes = number(row, 'num_episodes');
  const duration = number(row, 'average_episode_duration');
  return {
    id,
    title: string(row, 'title') ?? `Anime ${id}`,
    imageUrl: string(row, 'main_picture_medium') ?? string(row, 'main_picture_large'),
    englishTitle: string(row, 'alt_title_en'),
    japaneseTitle: string(row, 'alt_title_ja'),
    startDate: string(row, 'start_date'),
    endDate: string(row, 'end_date'),
    year: number(row, 'start_season_year'),
    season: string(row, 'start_season_season'),
    score: number(row, 'mean'),
    rank: number(row, 'rank'),
    popularity: number(row, 'popularity'),
    listUsers: number(row, 'num_list_users'),
    favorites: number(row, 'num_favorites'),
    mediaType: string(row, 'media_type'),
    status: string(row, 'status'),
    episodes,
    source: string(row, 'source'),
    episodeDuration: duration,
    totalDuration: episodes && duration ? episodes * duration : null,
    rating: string(row, 'rating'),
    nsfw: string(row, 'nsfw'),
    relatedCount: number(row, 'related_count') ?? 0,
    malUrl: `https://myanimelist.net/anime/${id}`
  };
}

type RawRelation = { fromId: number; toId: number; relation: string; label: string };
const rawRelations = db.prepare(`
  SELECT ara.anime_id AS fromId, ara.related_anime_id AS toId,
         rt.code AS relation, rt.formatted AS label
  FROM anime_related_anime ara
  JOIN relation_type rt ON rt.id = ara.relation_type_id
`).all() as RawRelation[];

const adjacency = new Map<number, RawRelation[]>();
for (const relation of rawRelations) {
  for (const id of [relation.fromId, relation.toId]) {
    const values = adjacency.get(id) ?? [];
    values.push(relation);
    adjacency.set(id, values);
  }
}

const CORE = new Set(['prequel', 'sequel', 'parent_story', 'full_story']);
const EXPANDED = new Set([
  ...CORE,
  'side_story',
  'spin_off',
  'summary',
  'alternative_version',
  'alternative_setting'
]);

function includedRelation(relation: string, scope: FranchiseScope) {
  if (scope === 'all') return true;
  return (scope === 'core' ? CORE : EXPANDED).has(relation);
}

export function getFranchise(seedId: number, scope: FranchiseScope, maxNodes = 1500) {
  if (!adjacency.has(seedId)) {
    const exists = db.prepare('SELECT 1 FROM anime WHERE id = ?').get(seedId);
    if (!exists) return null;
  }

  const ids = new Set<number>([seedId]);
  const queue = [seedId];
  const edges = new Map<string, FranchiseEdge>();
  let limited = false;

  for (let index = 0; index < queue.length; index += 1) {
    const currentId = queue[index];
    if (currentId === undefined) continue;
    for (const relation of adjacency.get(currentId) ?? []) {
      const included = includedRelation(relation.relation, scope);
      const key = `${relation.fromId}:${relation.toId}:${relation.relation}`;
      edges.set(key, { ...relation, included });
      if (!included) continue;
      const neighbor = relation.fromId === currentId ? relation.toId : relation.fromId;
      if (ids.has(neighbor)) continue;
      if (ids.size >= maxNodes) {
        limited = true;
        continue;
      }
      ids.add(neighbor);
      queue.push(neighbor);
    }
  }

  const rows = db.prepare(`
    SELECT ${ANIME_SELECT}
    FROM anime a
    WHERE a.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
    ORDER BY a.start_date IS NULL, a.start_date, a.title COLLATE NOCASE
  `).all(JSON.stringify([...ids])) as Raw[];

  return {
    nodes: rows.map(mapAnime),
    edges: [...edges.values()].filter((edge) => ids.has(edge.fromId) || ids.has(edge.toId)),
    limited
  };
}

export const databaseRevision = String(
  (db.prepare('SELECT MAX(fetched_at) AS revision FROM anime').get() as { revision?: string | null })
    .revision ?? 'unknown'
);
