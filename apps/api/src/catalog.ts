import type { AnimePage, Facets, MissingAnime, RecommendationResponse } from '@youranimelist/shared';
import { ANIME_SELECT, databaseRevision, db, getFranchise, mapAnime, RELATED_COUNT_SQL } from './database.js';

type Query = Record<string, string | undefined>;
type Params = Record<string, string | number>;
type Raw = Record<string, unknown>;

const SYNOPSIS_STOP_WORDS = new Set(`
  a about after again against all also am an and any are as at be because been before being between both but by can
  could did do does doing down during each few for from further had has have having he her here hers herself him
  himself his how i if in into is it its itself just more most my myself no nor not now of off on once only or other
  our ours ourselves out over own same she should so some such than that the their theirs them themselves then there
  these they this those through to too under until up very was we were what when where which while who whom why will
  with would you your yours yourself themselves anime story series one two new life world finds find young becomes
  however soon day years year written mal rewrite
`.trim().split(/\s+/));

function synopsisTerms(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return new Map<string, number>();
  const words = value.normalize('NFKD').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const meaningful = words.filter((word) => word.length >= 3 && !SYNOPSIS_STOP_WORDS.has(word) && !/^\d+$/.test(word));
  const terms = new Map<string, number>();
  for (const word of meaningful) terms.set(word, (terms.get(word) ?? 0) + 1);
  for (let index = 1; index < meaningful.length; index += 1) {
    const bigram = `${meaningful[index - 1]}:${meaningful[index]}`;
    terms.set(bigram, (terms.get(bigram) ?? 0) + 0.6);
  }
  return terms;
}

function synopsisSimilarities(seedSynopsis: unknown, rows: { id: number; synopsis: unknown }[]) {
  const documents = new Map<number, Map<string, number>>([[0, synopsisTerms(seedSynopsis)]]);
  for (const row of rows) documents.set(row.id, synopsisTerms(row.synopsis));
  const documentFrequency = new Map<string, number>();
  for (const terms of documents.values()) {
    for (const term of terms.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const count = documents.size;
  const weight = (term: string, frequency: number) => (1 + Math.log(frequency)) * (Math.log((count + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1);
  const seedTerms = documents.get(0) ?? new Map<string, number>();
  let seedNormSquared = 0;
  for (const [term, frequency] of seedTerms) seedNormSquared += weight(term, frequency) ** 2;
  const similarities = new Map<number, number>();
  for (const [id, terms] of documents) {
    if (id === 0) continue;
    let dot = 0;
    let normSquared = 0;
    for (const [term, frequency] of terms) {
      const termWeight = weight(term, frequency);
      normSquared += termWeight ** 2;
      const seedFrequency = seedTerms.get(term);
      if (seedFrequency) dot += termWeight * weight(term, seedFrequency);
    }
    similarities.set(id, seedNormSquared > 0 && normSquared > 0 ? dot / Math.sqrt(seedNormSquared * normSquared) : 0);
  }
  return similarities;
}

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
    ['popularityFrom', 'NULLIF(a.popularity, 0)', '>='], ['popularityTo', 'NULLIF(a.popularity, 0)', '<='],
    ['episodesFrom', 'a.num_episodes', '>='], ['episodesTo', 'a.num_episodes', '<='],
    ['relatedFrom', RELATED_COUNT_SQL, '>='], ['relatedTo', RELATED_COUNT_SQL, '<=']
  ] as const) {
    const value = numeric(query[queryKey]);
    if (value !== null) {
      where.push(`${expression} ${operation} @${queryKey}`);
      params[queryKey] = value;
    }
  }

  for (const [queryKey, expression, operation, secondsPerUnit] of [
    ['episodeDurationFrom', 'NULLIF(a.average_episode_duration, 0)', '>=', 60],
    ['episodeDurationTo', 'NULLIF(a.average_episode_duration, 0)', '<=', 60],
    ['runtimeFrom', '(NULLIF(a.num_episodes, 0) * NULLIF(a.average_episode_duration, 0))', '>=', 3600],
    ['runtimeTo', '(NULLIF(a.num_episodes, 0) * NULLIF(a.average_episode_duration, 0))', '<=', 3600]
  ] as const) {
    const value = numeric(query[queryKey]);
    if (value !== null) {
      where.push(`${expression} ${operation} @${queryKey}`);
      params[queryKey] = value * secondsPerUnit;
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
  const seed = mapAnime(seedRow);
  const directRows = db.prepare(`
    SELECT ar.recommended_anime_id AS id, ar.num_recommendations AS count
    FROM anime_recommendation ar WHERE ar.anime_id = ?
    ORDER BY ar.num_recommendations DESC
  `).all(seedId) as { id: number; count: number }[];
  let recommendationSourceId = seedId;
  let recommendationSourceTitle = seed.title;
  let rootRows = directRows;
  if (!rootRows.length) {
    const franchise = getFranchise(seedId, 'core');
    const franchiseIds = (franchise?.nodes ?? []).map((anime) => anime.id).filter((id) => id !== seedId);
    if (franchiseIds.length) {
      const proxy = db.prepare(`
        SELECT ar.anime_id AS id, SUM(ar.num_recommendations) AS strength
        FROM anime_recommendation ar
        WHERE ar.anime_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
        GROUP BY ar.anime_id
        ORDER BY strength DESC
        LIMIT 1
      `).get(JSON.stringify(franchiseIds)) as { id: number; strength: number } | undefined;
      if (proxy) {
        recommendationSourceId = proxy.id;
        recommendationSourceTitle = franchise?.nodes.find((anime) => anime.id === proxy.id)?.title ?? `Anime ${proxy.id}`;
        rootRows = db.prepare(`
          SELECT recommended_anime_id AS id, num_recommendations AS count
          FROM anime_recommendation WHERE anime_id = ?
          ORDER BY num_recommendations DESC
        `).all(proxy.id) as { id: number; count: number }[];
      }
    }
  }
  const rootIds = rootRows.map((row) => row.id);
  const branchRows = rootIds.length ? db.prepare(`
    SELECT ar.anime_id AS source_id, ar.recommended_anime_id AS id, ar.num_recommendations AS count
    FROM anime_recommendation ar
    WHERE ar.anime_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
  `).all(JSON.stringify(rootIds)) as { source_id: number; id: number; count: number }[] : [];

  const genreStats = db.prepare(`
    SELECT g.id, g.name, COUNT(ag.anime_id) AS count
    FROM genre g JOIN anime_genre ag ON ag.genre_id = g.id
    GROUP BY g.id, g.name
  `).all() as { id: number; name: string; count: number }[];
  const animeCount = (db.prepare('SELECT COUNT(*) AS count FROM anime').get() as { count: number }).count;
  const genreWeight = new Map(genreStats.map((genre) => [genre.id, Math.log((animeCount + 1) / (genre.count + 1)) + 1]));
  const genreName = new Map(genreStats.map((genre) => [genre.id, genre.name]));
  const seedGenres = new Set((db.prepare('SELECT genre_id AS id FROM anime_genre WHERE anime_id = ?').all(seedId) as { id: number }[]).map((row) => row.id));
  const weightedSeedGenres = [...seedGenres].map((id) => ({ id, weight: genreWeight.get(id) ?? 1 }));
  const preliminaryMetadata = weightedSeedGenres.length ? db.prepare(`
    WITH selected AS (
      SELECT CAST(json_extract(value, '$.id') AS INTEGER) AS genre_id,
             CAST(json_extract(value, '$.weight') AS REAL) AS weight
      FROM json_each(@genres)
    )
    SELECT ag.anime_id AS id, SUM(selected.weight) AS overlap, COUNT(*) AS shared
    FROM anime_genre ag JOIN selected ON selected.genre_id = ag.genre_id
    WHERE ag.anime_id != @seedId
    GROUP BY ag.anime_id
    ORDER BY overlap DESC, shared DESC
    LIMIT 250
  `).all({ genres: JSON.stringify(weightedSeedGenres), seedId }) as { id: number; overlap: number; shared: number }[] : [];

  const graphIds = [...new Set([...rootIds, ...branchRows.map((row) => row.id)])].filter((id) => id !== seedId);
  const genreCandidateIds = [...new Set([...graphIds, ...preliminaryMetadata.map((row) => row.id)])];
  const genreRows = genreCandidateIds.length ? db.prepare(`
    SELECT anime_id AS animeId, genre_id AS genreId FROM anime_genre
    WHERE anime_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
  `).all(JSON.stringify(genreCandidateIds)) as { animeId: number; genreId: number }[] : [];
  const genresByAnime = new Map<number, Set<number>>();
  for (const row of genreRows) {
    const genres = genresByAnime.get(row.animeId) ?? new Set<number>();
    genres.add(row.genreId);
    genresByAnime.set(row.animeId, genres);
  }
  const genreSimilarity = (id: number) => {
    const candidateGenres = genresByAnime.get(id) ?? new Set<number>();
    let intersection = 0;
    let union = 0;
    for (const genreId of new Set([...seedGenres, ...candidateGenres])) {
      const weight = genreWeight.get(genreId) ?? 1;
      union += weight;
      if (seedGenres.has(genreId) && candidateGenres.has(genreId)) intersection += weight;
    }
    return union > 0 ? intersection / union : 0;
  };
  const synopsisRow = db.prepare('SELECT synopsis FROM anime WHERE id = ?').get(seedId) as { synopsis: unknown } | undefined;
  const synopsisRows = genreCandidateIds.length ? db.prepare(`
    SELECT id, synopsis FROM anime
    WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
  `).all(JSON.stringify(genreCandidateIds)) as { id: number; synopsis: unknown }[] : [];
  const synopsisByAnime = synopsisSimilarities(synopsisRow?.synopsis, synopsisRows);
  // Metadata expands sparse results; rich recommendation graphs only use it for reranking.
  const metadataSlots = Math.max(0, 40 - graphIds.length);
  const metadataIds = preliminaryMetadata
    .map((row) => ({ id: row.id, genres: genreSimilarity(row.id), synopsis: synopsisByAnime.get(row.id) ?? 0 }))
    .filter((row) => row.genres >= 0.2 && row.synopsis >= 0.035)
    .sort((a, b) => (b.genres * 0.6 + b.synopsis * 0.4) - (a.genres * 0.6 + a.synopsis * 0.4))
    .slice(0, metadataSlots)
    .map((row) => row.id);
  const allIds = [...new Set([...graphIds, ...metadataIds])];
  const animeRows = allIds.length ? db.prepare(`SELECT ${ANIME_SELECT} FROM anime a WHERE a.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`).all(JSON.stringify(allIds)) as Raw[] : [];
  const animeById = new Map(animeRows.map((row) => { const anime = mapAnime(row); return [anime.id, anime]; }));
  const titleById = new Map([[seedId, seed.title], [recommendationSourceId, recommendationSourceTitle], ...[...animeById].map(([id, anime]) => [id, anime.title] as const)]);
  const directTotal = rootRows.reduce((total, row) => total + Math.max(row.count, 0), 0);
  const rootProbability = new Map(rootRows.map((root) => [root.id, directTotal > 0 ? root.count / directTotal : 0]));
  const branchTotals = new Map<number, number>();
  for (const branch of branchRows) branchTotals.set(branch.source_id, (branchTotals.get(branch.source_id) ?? 0) + Math.max(branch.count, 0));
  const aggregate = new Map<number, { directCount: number; directProbability: number; indirectProbability: number; sources: Map<number, number> }>();
  for (const root of rootRows) aggregate.set(root.id, {
    directCount: recommendationSourceId === seedId ? root.count : 0,
    directProbability: rootProbability.get(root.id) ?? 0,
    indirectProbability: 0,
    sources: new Map([[recommendationSourceId, root.count]])
  });
  for (const branch of branchRows) {
    if (branch.id === seedId) continue;
    const current = aggregate.get(branch.id) ?? { directCount: 0, directProbability: 0, indirectProbability: 0, sources: new Map() };
    const branchTotal = branchTotals.get(branch.source_id) ?? 0;
    if (branchTotal > 0) current.indirectProbability += (rootProbability.get(branch.source_id) ?? 0) * (branch.count / branchTotal);
    current.sources.set(branch.source_id, branch.count);
    aggregate.set(branch.id, current);
  }
  for (const id of metadataIds) {
    if (!aggregate.has(id)) aggregate.set(id, { directCount: 0, directProbability: 0, indirectProbability: 0, sources: new Map() });
  }

  const rawGraphScores = new Map([...aggregate].map(([id, value]) => [id, value.directProbability * 0.75 + value.indirectProbability * 0.25]));
  const maxGraphScore = Math.max(0, ...rawGraphScores.values());
  const compatibility = (anime: ReturnType<typeof mapAnime>) => {
    const format = seed.mediaType && anime.mediaType ? (seed.mediaType === anime.mediaType ? 1 : 0.35) : 0.5;
    const ratings = ['g', 'pg', 'pg_13', 'r', 'r+', 'rx'];
    const seedRating = seed.rating ? ratings.indexOf(seed.rating) : -1;
    const candidateRating = anime.rating ? ratings.indexOf(anime.rating) : -1;
    const audience = seedRating >= 0 && candidateRating >= 0 ? Math.max(0, 1 - Math.abs(seedRating - candidateRating) / 3) : 0.5;
    return format * 0.6 + audience * 0.4;
  };
  const hasGraph = maxGraphScore > 0;
  const items = [...aggregate].flatMap(([id, value]) => {
    const anime = animeById.get(id);
    if (!anime) return [];
    const graph = maxGraphScore > 0 ? (rawGraphScores.get(id) ?? 0) / maxGraphScore : 0;
    const genres = genreSimilarity(id);
    const synopsis = synopsisByAnime.get(id) ?? 0;
    const compatible = compatibility(anime);
    const rawOlderBonus = seed.year && anime.year && anime.year < seed.year ? Math.min((seed.year - anime.year) * 0.005, 0.05) : 0;
    // Age can break a close race, but it must not make a weak metadata match look relevant by itself.
    const evidenceConfidence = graph > 0 ? Math.max(graph, 0.25) : Math.min(1, genres * 0.6 + synopsis * 2);
    const olderBonus = rawOlderBonus * evidenceConfidence;
    const supportingPaths = value.sources.size - (value.sources.has(recommendationSourceId) ? 1 : 0);
    const supportBonus = Math.min(supportingPaths, 4) * 0.01;
    const combined = (hasGraph
      ? graph * 0.77 + genres * 0.13 + synopsis * 0.02 + compatible * 0.03 + olderBonus
      : genres * 0.45 + synopsis * 0.35 + compatible * 0.15 + olderBonus) + supportBonus;
    const sourceCount = value.sources.size;
    const indirectSources = [...value.sources].filter(([sourceId]) => sourceId !== seedId);
    const sharedGenres = [...(genresByAnime.get(id) ?? [])]
      .filter((genreId) => seedGenres.has(genreId))
      .sort((a, b) => (genreWeight.get(b) ?? 0) - (genreWeight.get(a) ?? 0))
      .slice(0, 3)
      .map((genreId) => genreName.get(genreId))
      .filter((name): name is string => Boolean(name));
    const recommendationKind: 'direct' | 'indirect' | 'metadata' = value.directCount > 0 ? 'direct' : value.sources.size > 0 ? 'indirect' : 'metadata';
    const reasons: string[] = [];
    if (value.directCount > 0) reasons.push(`${value.directCount} direct ${value.directCount === 1 ? 'vote' : 'votes'}`);
    if (indirectSources.length) reasons.push(`via ${indirectSources.slice(0, 3).map(([sourceId]) => titleById.get(sourceId) ?? `Anime ${sourceId}`).join(', ')}`);
    if (sharedGenres.length) reasons.push(`shared ${sharedGenres.join(', ')}`);
    if (synopsis >= 0.08) reasons.push('similar premise');
    if (recommendationKind === 'metadata') reasons.unshift('metadata discovery');
    if (olderBonus > 0) reasons.push('earlier title');
    return [{
      ...anime,
      recommendationScore: Math.round(combined * 10000) / 100,
      recommendationCount: value.directCount,
      sourceCount,
      sources: [...value.sources].map(([animeId, count]) => ({ animeId, title: titleById.get(animeId) ?? `Anime ${animeId}`, count })),
      recommendationKind,
      reasons,
      scoreBreakdown: {
        graph: Math.round(graph * 10000) / 100,
        genres: Math.round(genres * 10000) / 100,
        synopsis: Math.round(synopsis * 10000) / 100,
        compatibility: Math.round(compatible * 10000) / 100,
        supportBonus: Math.round(supportBonus * 10000) / 100,
        olderBonus: Math.round(olderBonus * 10000) / 100
      }
    }];
  }).sort((a, b) => b.recommendationScore - a.recommendationScore || b.sourceCount - a.sourceCount || a.title.localeCompare(b.title));
  return { seed, items, revision: databaseRevision };
}
