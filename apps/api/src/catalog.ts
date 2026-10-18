import type { AnimePage, Facets, MissingAnime, RecommendationResponse } from '@youranimelist/shared';
import { ANIME_SELECT, databaseRevision, db, mapAnime, RELATED_COUNT_SQL } from './database.js';

type Query = Record<string, string | undefined>;
type Params = Record<string, string | number>;
type Raw = Record<string, unknown>;

const SORTS: Record<string, string> = {
  score_desc: 'a.mean IS NULL, a.mean DESC, a.id',
  score_asc: 'a.mean IS NULL, a.mean ASC, a.id',
  title: 'a.title COLLATE NOCASE, a.id',
  newest: 'a.start_date IS NULL, a.start_date DESC, a.id DESC',
  oldest: 'a.start_date IS NULL, a.start_date, a.id',
  popularity: 'NULLIF(a.popularity, 0) IS NULL, a.popularity, a.id',
  episodes_desc: 'NULLIF(a.num_episodes, 0) IS NULL, a.num_episodes DESC, a.id',
  episode_duration_desc: 'NULLIF(a.average_episode_duration, 0) IS NULL, NULLIF(a.average_episode_duration, 0) DESC, a.id',
  episode_duration_asc: 'NULLIF(a.average_episode_duration, 0) IS NULL, NULLIF(a.average_episode_duration, 0), a.id',
  runtime_desc: '(NULLIF(a.num_episodes, 0) * NULLIF(a.average_episode_duration, 0)) IS NULL, (NULLIF(a.num_episodes, 0) * NULLIF(a.average_episode_duration, 0)) DESC, a.id',
  runtime_asc: '(NULLIF(a.num_episodes, 0) * NULLIF(a.average_episode_duration, 0)) IS NULL, (NULLIF(a.num_episodes, 0) * NULLIF(a.average_episode_duration, 0)), a.id',
  related_desc: `${RELATED_COUNT_SQL} DESC, a.id`,
  related_asc: `${RELATED_COUNT_SQL}, a.id`
};

function decodeCursor(value?: string) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as { offset?: number };
    return Number.isInteger(parsed.offset) && (parsed.offset ?? 0) >= 0 ? parsed.offset! : 0;
  } catch {
    return 0;
  }
}

function list(value?: string) {
  return [...new Set((value ?? '').split(',').map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

function numeric(value?: string) {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildWhere(query: Query) {
  const where: string[] = [];
  const params: Params = {};
  const q = query.q?.trim();
  if (q) {
    where.push(`(
      a.title LIKE @q COLLATE NOCASE OR a.alt_title_en LIKE @q COLLATE NOCASE OR
      a.alt_title_ja LIKE @q COLLATE NOCASE OR EXISTS (
        SELECT 1 FROM anime_synonym syn WHERE syn.anime_id = a.id AND syn.synonym LIKE @q COLLATE NOCASE
      )
    )`);
    params.q = `%${q}%`;
  }

  for (const [queryKey, column] of [
    ['mediaType', 'media_type'], ['status', 'status'], ['source', 'source'],
    ['rating', 'rating'], ['season', 'start_season_season']
  ] as const) {
    const value = query[queryKey]?.trim();
    if (value) {
      where.push(`a.${column} = @${queryKey}`);
      params[queryKey] = value;
    }
  }

  for (const [queryKey, expression, operation] of [
    ['yearFrom', 'a.start_season_year', '>='], ['yearTo', 'a.start_season_year', '<='],
    ['scoreFrom', 'a.mean', '>='], ['scoreTo', 'a.mean', '<='],
    ['episodesFrom', 'a.num_episodes', '>='], ['episodesTo', 'a.num_episodes', '<='],
    ['relatedFrom', RELATED_COUNT_SQL, '>='], ['relatedTo', RELATED_COUNT_SQL, '<=']
  ] as const) {
    const value = numeric(query[queryKey]);
    if (value !== null) {
      where.push(`${expression} ${operation} @${queryKey}`);
      params[queryKey] = value;
    }
  }

  for (const [key, table, column] of [
    ['genres', 'anime_genre', 'genre_id'], ['studios', 'anime_studio', 'studio_id']
  ] as const) {
    for (const [index, id] of list(query[key]).entries()) {
      const param = `${key}${index}`;
      where.push(`EXISTS (SELECT 1 FROM ${table} rel WHERE rel.anime_id = a.id AND rel.${column} = @${param})`);
      params[param] = id;
    }
  }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function getAnimePage(query: Query): AnimePage {
  const limit = Math.min(Math.max(numeric(query.limit) ?? 100, 25), 200);
  const offset = decodeCursor(query.cursor);
  const order = SORTS[query.sort ?? ''] ?? SORTS.score_desc;
  const { sql, params } = buildWhere(query);
  const rows = db.prepare(`SELECT ${ANIME_SELECT} FROM anime a ${sql} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset }) as Raw[];
  const total = (db.prepare(`SELECT COUNT(*) AS total FROM anime a ${sql}`).get(params) as { total: number }).total;
  const nextOffset = offset + rows.length;
  return {
    items: rows.map(mapAnime),
    total,
    nextCursor: nextOffset < total ? Buffer.from(JSON.stringify({ offset: nextOffset })).toString('base64url') : null,
    revision: databaseRevision
  };
}

function values(column: string) {
  return db.prepare(`SELECT ${column} AS value, COUNT(*) AS count FROM anime WHERE ${column} IS NOT NULL AND ${column} != '' GROUP BY ${column} ORDER BY count DESC, value COLLATE NOCASE`).all();
}

export function getFacets(): Facets {
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  const years = db.prepare('SELECT MIN(start_season_year) AS min, MAX(start_season_year) AS max FROM anime').get() as { min: number | null; max: number | null };
  return {
    revision: databaseRevision,
    counts: { anime: count('anime'), relations: count('anime_related_anime'), genres: count('genre'), studios: count('studio') },
    genres: db.prepare('SELECT g.id, g.name, COUNT(*) AS count FROM genre g JOIN anime_genre ag ON ag.genre_id = g.id GROUP BY g.id, g.name ORDER BY count DESC, g.name COLLATE NOCASE').all() as Facets['genres'],
    studios: db.prepare('SELECT s.id, s.name, COUNT(*) AS count FROM studio s JOIN anime_studio ast ON ast.studio_id = s.id GROUP BY s.id, s.name ORDER BY count DESC, s.name COLLATE NOCASE').all() as Facets['studios'],
    mediaTypes: values('media_type') as Facets['mediaTypes'],
    statuses: values('status') as Facets['statuses'],
    sources: values('source') as Facets['sources'],
    ratings: values('rating') as Facets['ratings'],
    seasons: values('start_season_season') as Facets['seasons'],
    years
  };
}

export function getMissingEntries(animeIds: number[]): MissingAnime[] {
  if (!animeIds.length) return [];
  const idJson = JSON.stringify(animeIds);
  const rows = db.prepare(`
    WITH owned(id) AS (SELECT CAST(value AS INTEGER) FROM json_each(@ids)), candidates AS (
      SELECT ara.related_anime_id AS id, ara.anime_id AS source_id, rt.code AS relation, rt.formatted AS label
      FROM anime_related_anime ara JOIN relation_type rt ON rt.id = ara.relation_type_id
      WHERE ara.anime_id IN owned AND ara.related_anime_id NOT IN owned
      UNION ALL
      SELECT ara.anime_id, ara.related_anime_id, rt.code, rt.formatted
      FROM anime_related_anime ara JOIN relation_type rt ON rt.id = ara.relation_type_id
      WHERE ara.related_anime_id IN owned AND ara.anime_id NOT IN owned
    )
    SELECT ${ANIME_SELECT}, c.source_id, source.title AS source_title, c.relation, c.label
    FROM candidates c JOIN anime a ON a.id = c.id JOIN anime source ON source.id = c.source_id
  `).all({ ids: idJson }) as Raw[];
  const grouped = new Map<number, MissingAnime>();
  for (const row of rows) {
    const anime = mapAnime(row);
    const current = grouped.get(anime.id) ?? { ...anime, missingSources: [] };
    current.missingSources.push({
      animeId: Number(row.source_id), title: String(row.source_title),
      relation: String(row.relation), label: String(row.label)
    });
    grouped.set(anime.id, current);
  }
  return [...grouped.values()].sort((a, b) => b.missingSources.length - a.missingSources.length || a.title.localeCompare(b.title));
}

export function getRecommendations(seedId: number): RecommendationResponse | null {
  const seedRow = db.prepare(`SELECT ${ANIME_SELECT} FROM anime a WHERE a.id = ?`).get(seedId) as Raw | undefined;
  if (!seedRow) return null;
  const rootRows = db.prepare(`
    SELECT ar.recommended_anime_id AS id, ar.num_recommendations AS count
    FROM anime_recommendation ar WHERE ar.anime_id = ?
    ORDER BY ar.num_recommendations DESC LIMIT 30
  `).all(seedId) as { id: number; count: number }[];
  const rootIds = rootRows.map((row) => row.id);
  const branchRows = rootIds.length ? db.prepare(`
    WITH ranked AS (
      SELECT ar.anime_id AS source_id, ar.recommended_anime_id AS id, ar.num_recommendations AS count,
             ROW_NUMBER() OVER (PARTITION BY ar.anime_id ORDER BY ar.num_recommendations DESC) AS position
      FROM anime_recommendation ar
      WHERE ar.anime_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
    ) SELECT source_id, id, count FROM ranked WHERE position <= 25
  `).all(JSON.stringify(rootIds)) as { source_id: number; id: number; count: number }[] : [];
  const allIds = [...new Set([...rootIds, ...branchRows.map((row) => row.id)])].filter((id) => id !== seedId);
  const animeRows = allIds.length ? db.prepare(`SELECT ${ANIME_SELECT} FROM anime a WHERE a.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`).all(JSON.stringify(allIds)) as Raw[] : [];
  const animeById = new Map(animeRows.map((row) => { const anime = mapAnime(row); return [anime.id, anime]; }));
  const titleById = new Map([[seedId, mapAnime(seedRow).title], ...[...animeById].map(([id, anime]) => [id, anime.title] as const)]);
  const aggregate = new Map<number, { direct: boolean; count: number; sources: Map<number, number> }>();
  for (const root of rootRows) aggregate.set(root.id, { direct: true, count: root.count, sources: new Map([[seedId, root.count]]) });
  for (const branch of branchRows) {
    if (branch.id === seedId) continue;
    const current = aggregate.get(branch.id) ?? { direct: false, count: 0, sources: new Map() };
    current.count += branch.count;
    current.sources.set(branch.source_id, branch.count);
    aggregate.set(branch.id, current);
  }
  const items = [...aggregate].flatMap(([id, value]) => {
    const anime = animeById.get(id);
    if (!anime) return [];
    const sourceCount = value.sources.size;
    return [{
      ...anime,
      recommendationScore: Math.round((value.direct ? value.count : value.count * (1 + Math.log2(Math.max(sourceCount, 1))) * 0.4) * 100) / 100,
      recommendationCount: value.count,
      sourceCount,
      sources: [...value.sources].map(([animeId, count]) => ({ animeId, title: titleById.get(animeId) ?? `Anime ${animeId}`, count }))
    }];
  }).sort((a, b) => b.recommendationScore - a.recommendationScore || b.sourceCount - a.sourceCount || a.title.localeCompare(b.title));
  return { seed: mapAnime(seedRow), items, revision: databaseRevision };
}
