import { access, appendFile, constants, copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CrawlerStatus } from '@youranimelist/shared';
import Database from 'better-sqlite3';

type Picture = { medium?: string | null; large?: string | null };
type NamedNode = { id: number; name: string };
type WorkNode = { id: number; title: string; main_picture?: Picture | null };
type RelatedNode = {
  node: WorkNode;
  relation_type: string;
  relation_type_formatted?: string | null;
};
type RecommendationNode = { node: WorkNode; num_recommendations?: number | null };
type Theme = { id?: number | null; text: string };
type AnimeDetails = WorkNode & {
  alternative_titles?: { synonyms?: string[] | null; en?: string | null; ja?: string | null } | null;
  start_date?: string | null;
  end_date?: string | null;
  synopsis?: string | null;
  mean?: number | null;
  rank?: number | null;
  popularity?: number | null;
  num_list_users?: number | null;
  num_scoring_users?: number | null;
  num_favorites?: number | null;
  nsfw?: string | null;
  genres?: NamedNode[];
  created_at?: string | null;
  updated_at?: string | null;
  media_type?: string | null;
  status?: string | null;
  num_episodes?: number | null;
  start_season?: { year?: number | null; season?: string | null } | null;
  broadcast?: { day_of_the_week?: string | null; start_time?: string | null } | null;
  source?: string | null;
  average_episode_duration?: number | null;
  rating?: string | null;
  studios?: NamedNode[];
  pictures?: Picture[];
  background?: string | null;
  related_anime?: RelatedNode[];
  related_manga?: RelatedNode[];
  recommendations?: RecommendationNode[];
  statistics?: {
    num_list_users?: number | null;
    status?: {
      watching?: number | null;
      completed?: number | null;
      on_hold?: number | null;
      dropped?: number | null;
      plan_to_watch?: number | null;
    };
  } | null;
  opening_themes?: Theme[];
  ending_themes?: Theme[];
};

type Options = {
  source: string;
  database: string;
  mode: 'sample' | 'full';
  schedule: 'once' | 'continuous';
  publish: boolean;
  from: number;
  count: number;
  minDelayMs: number;
  maxDelayMs: number;
  missLimit: number;
  intervalMs: number;
  statusFile: string;
  logFile: string;
};

const FIELDS = [
  'alternative_titles', 'start_date', 'end_date', 'synopsis', 'mean', 'rank', 'popularity',
  'num_list_users', 'num_scoring_users', 'num_favorites', 'nsfw', 'genres', 'created_at',
  'updated_at', 'media_type', 'status', 'num_episodes', 'start_season', 'broadcast', 'source',
  'average_episode_duration', 'rating', 'studios', 'pictures', 'background', 'related_anime',
  'related_manga', 'recommendations', 'statistics', 'opening_themes', 'ending_themes'
].join(',');

function integer(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function options(args: string[]): Options {
  if (args[0] === '--') args = args.slice(1);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near ${key ?? '(end)'}`);
    values.set(key.slice(2), value);
  }
  const source = values.get('source');
  const database = values.get('database');
  if (!source || !database) throw new Error('Both --source and --database are required. The source is never modified.');
  const result = {
    source,
    database,
    mode: values.get('mode') === 'full' ? 'full' as const : 'sample' as const,
    schedule: values.get('schedule') === 'continuous' ? 'continuous' as const : 'once' as const,
    publish: values.get('publish') === 'true',
    from: integer(values.get('from'), 1),
    count: integer(values.get('count'), 10),
    minDelayMs: integer(values.get('min-delay-ms'), 1000),
    maxDelayMs: integer(values.get('max-delay-ms'), 3000),
    missLimit: integer(values.get('miss-limit'), 1000),
    intervalMs: integer(values.get('interval-hours'), 168) * 60 * 60_000,
    statusFile: values.get('status-file') ?? `${database}.status.json`,
    logFile: values.get('log-file') ?? `${database}.log`
  };
  if (result.maxDelayMs < result.minDelayMs) throw new Error('--max-delay-ms must be greater than or equal to --min-delay-ms');
  return result;
}

async function exists(path: string) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function createWorkingCopy(sourcePath: string, databasePath: string, resume = false) {
  if (await exists(databasePath)) {
    if (resume) return;
    throw new Error(`Destination already exists: ${databasePath}`);
  }
  await mkdir(dirname(databasePath), { recursive: true });
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try { await source.backup(databasePath); } finally { source.close(); }
}

function ensureColumn(db: Database.Database, table: string, name: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function migrate(db: Database.Database) {
  for (const [name, definition] of [
    ['num_watching_users', 'INTEGER'],
    ['num_completed_users', 'INTEGER'],
    ['num_on_hold_users', 'INTEGER'],
    ['num_dropped_users', 'INTEGER'],
    ['num_plan_to_watch_users', 'INTEGER']
  ]) ensureColumn(db, 'anime', name!, definition!);

  db.exec(`
    CREATE TABLE IF NOT EXISTS manga_stub (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      main_picture_medium TEXT,
      main_picture_large TEXT
    );
    CREATE TABLE IF NOT EXISTS crawl_run (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pass_number INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
      from_anime_id INTEGER NOT NULL,
      to_anime_id INTEGER NOT NULL,
      current_anime_id INTEGER,
      requests INTEGER NOT NULL DEFAULT 0,
      refreshed INTEGER NOT NULL DEFAULT 0,
      discovered INTEGER NOT NULL DEFAULT 0,
      not_found INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_anime_related_anime_reverse ON anime_related_anime(related_anime_id);
    CREATE INDEX IF NOT EXISTS idx_anime_related_manga_reverse ON anime_related_manga(related_manga_id);
    CREATE INDEX IF NOT EXISTS idx_anime_genre_genre ON anime_genre(genre_id);
    CREATE INDEX IF NOT EXISTS idx_anime_studio_studio ON anime_studio(studio_id);
    CREATE INDEX IF NOT EXISTS idx_anime_status ON anime(status);
    CREATE INDEX IF NOT EXISTS idx_anime_popularity ON anime(popularity);
  `);
  ensureColumn(db, 'crawl_run', 'skipped', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'crawl_run', 'phase', 'TEXT');
}

function relationTypeId(db: Database.Database, relation: RelatedNode) {
  db.prepare(`
    INSERT INTO relation_type (code, formatted) VALUES (@code, @formatted)
    ON CONFLICT(code) DO UPDATE SET formatted = COALESCE(excluded.formatted, relation_type.formatted)
  `).run({ code: relation.relation_type, formatted: relation.relation_type_formatted ?? null });
  return (db.prepare('SELECT id FROM relation_type WHERE code = ?').get(relation.relation_type) as { id: number }).id;
}

function replaceChildren(db: Database.Database, anime: AnimeDetails) {
  const animeId = anime.id;
  for (const table of [
    'anime_genre', 'anime_picture', 'anime_recommendation', 'anime_related_anime',
    'anime_related_manga', 'anime_studio', 'anime_synonym', 'anime_theme'
  ]) db.prepare(`DELETE FROM ${table} WHERE anime_id = ?`).run(animeId);

  const insertGenre = db.prepare(`INSERT INTO genre (id, name) VALUES (@id, @name)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name`);
  const linkGenre = db.prepare('INSERT INTO anime_genre (anime_id, genre_id) VALUES (?, ?)');
  for (const genre of anime.genres ?? []) { insertGenre.run(genre); linkGenre.run(animeId, genre.id); }

  const insertStudio = db.prepare(`INSERT INTO studio (id, name) VALUES (@id, @name)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name`);
  const linkStudio = db.prepare('INSERT INTO anime_studio (anime_id, studio_id) VALUES (?, ?)');
  for (const studio of anime.studios ?? []) { insertStudio.run(studio); linkStudio.run(animeId, studio.id); }

  const insertSynonym = db.prepare('INSERT INTO anime_synonym (anime_id, synonym, position) VALUES (?, ?, ?)');
  const synonyms = [...new Set(anime.alternative_titles?.synonyms ?? [])];
  for (const [position, synonym] of synonyms.entries()) insertSynonym.run(animeId, synonym, position);

  const insertPicture = db.prepare('INSERT INTO anime_picture (anime_id, position, medium, large) VALUES (?, ?, ?, ?)');
  for (const [position, picture] of (anime.pictures ?? []).entries()) insertPicture.run(animeId, position, picture.medium ?? null, picture.large ?? null);

  const insertRelatedAnime = db.prepare(`
    INSERT INTO anime_related_anime (anime_id, related_anime_id, relation_type_id) VALUES (?, ?, ?)
  `);
  for (const relation of anime.related_anime ?? []) insertRelatedAnime.run(animeId, relation.node.id, relationTypeId(db, relation));

  const insertManga = db.prepare(`
    INSERT INTO manga_stub (id, title, main_picture_medium, main_picture_large)
    VALUES (@id, @title, @medium, @large)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title,
      main_picture_medium = excluded.main_picture_medium, main_picture_large = excluded.main_picture_large
  `);
  const insertRelatedManga = db.prepare(`
    INSERT INTO anime_related_manga (anime_id, related_manga_id, relation_type_id) VALUES (?, ?, ?)
  `);
  for (const relation of anime.related_manga ?? []) {
    insertManga.run({
      id: relation.node.id,
      title: relation.node.title,
      medium: relation.node.main_picture?.medium ?? null,
      large: relation.node.main_picture?.large ?? null
    });
    insertRelatedManga.run(animeId, relation.node.id, relationTypeId(db, relation));
  }

  const insertRecommendation = db.prepare(`
    INSERT INTO anime_recommendation (anime_id, recommended_anime_id, num_recommendations) VALUES (?, ?, ?)
  `);
  for (const recommendation of anime.recommendations ?? []) {
    insertRecommendation.run(animeId, recommendation.node.id, recommendation.num_recommendations ?? 0);
  }

  const insertTheme = db.prepare(`
    INSERT INTO anime_theme (anime_id, theme_type, theme_id, position, text) VALUES (?, ?, ?, ?, ?)
  `);
  for (const [type, themes] of [['opening', anime.opening_themes ?? []], ['ending', anime.ending_themes ?? []]] as const) {
    for (const [position, theme] of themes.entries()) insertTheme.run(animeId, type, theme.id ?? null, position, theme.text);
  }
}

function storeAnime(db: Database.Database, anime: AnimeDetails, fetchedAt: string) {
  const status = anime.statistics?.status;
  db.prepare(`
    INSERT INTO anime (
      id, title, main_picture_medium, main_picture_large, alt_title_en, alt_title_ja,
      start_date, end_date, synopsis, mean, rank, popularity, num_list_users,
      num_scoring_users, num_favorites, nsfw, media_type, status, num_episodes,
      start_season_year, start_season_season, broadcast_day, broadcast_start_time,
      source, average_episode_duration, rating, background, created_at, updated_at,
      fetched_at, num_watching_users, num_completed_users, num_on_hold_users,
      num_dropped_users, num_plan_to_watch_users
    ) VALUES (
      @id, @title, @pictureMedium, @pictureLarge, @titleEn, @titleJa,
      @startDate, @endDate, @synopsis, @mean, @rank, @popularity, @listUsers,
      @scoringUsers, @favorites, @nsfw, @mediaType, @status, @episodes,
      @seasonYear, @season, @broadcastDay, @broadcastTime,
      @source, @duration, @rating, @background, @createdAt, @updatedAt,
      @fetchedAt, @watching, @completed, @onHold, @dropped, @planToWatch
    ) ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, main_picture_medium = excluded.main_picture_medium,
      main_picture_large = excluded.main_picture_large, alt_title_en = excluded.alt_title_en,
      alt_title_ja = excluded.alt_title_ja, start_date = excluded.start_date,
      end_date = excluded.end_date, synopsis = excluded.synopsis, mean = excluded.mean,
      rank = excluded.rank, popularity = excluded.popularity, num_list_users = excluded.num_list_users,
      num_scoring_users = excluded.num_scoring_users, num_favorites = excluded.num_favorites,
      nsfw = excluded.nsfw, media_type = excluded.media_type, status = excluded.status,
      num_episodes = excluded.num_episodes, start_season_year = excluded.start_season_year,
      start_season_season = excluded.start_season_season, broadcast_day = excluded.broadcast_day,
      broadcast_start_time = excluded.broadcast_start_time, source = excluded.source,
      average_episode_duration = excluded.average_episode_duration, rating = excluded.rating,
      background = excluded.background, created_at = COALESCE(excluded.created_at, anime.created_at),
      updated_at = excluded.updated_at, fetched_at = excluded.fetched_at,
      num_watching_users = excluded.num_watching_users,
      num_completed_users = excluded.num_completed_users,
      num_on_hold_users = excluded.num_on_hold_users,
      num_dropped_users = excluded.num_dropped_users,
      num_plan_to_watch_users = excluded.num_plan_to_watch_users
  `).run({
    id: anime.id,
    title: anime.title,
    pictureMedium: anime.main_picture?.medium ?? null,
    pictureLarge: anime.main_picture?.large ?? null,
    titleEn: anime.alternative_titles?.en ?? null,
    titleJa: anime.alternative_titles?.ja ?? null,
    startDate: anime.start_date ?? null,
    endDate: anime.end_date ?? null,
    synopsis: anime.synopsis ?? null,
    mean: anime.mean ?? null,
    rank: anime.rank ?? null,
    popularity: anime.popularity ?? null,
    listUsers: anime.num_list_users ?? null,
    scoringUsers: anime.num_scoring_users ?? null,
    favorites: anime.num_favorites ?? null,
    nsfw: anime.nsfw ?? null,
    mediaType: anime.media_type ?? null,
    status: anime.status ?? null,
    episodes: anime.num_episodes ?? null,
    seasonYear: anime.start_season?.year ?? null,
    season: anime.start_season?.season ?? null,
    broadcastDay: anime.broadcast?.day_of_the_week ?? null,
    broadcastTime: anime.broadcast?.start_time ?? null,
    source: anime.source ?? null,
    duration: anime.average_episode_duration ?? null,
    rating: anime.rating ?? null,
    background: anime.background ?? null,
    createdAt: anime.created_at ?? null,
    updatedAt: anime.updated_at ?? null,
    fetchedAt,
    watching: status?.watching ?? null,
    completed: status?.completed ?? null,
    onHold: status?.on_hold ?? null,
    dropped: status?.dropped ?? null,
    planToWatch: status?.plan_to_watch ?? null
  });
  replaceChildren(db, anime);
}

function recordFetch(db: Database.Database, animeId: number, result: 'fetched' | 'not_found' | 'error', fetchedAt: string | null, httpStatus: number | null, error: string | null) {
  db.prepare(`
    INSERT INTO anime_fetch_status (anime_id, status, attempts, last_error, last_http_status, fetched_at, updated_at)
    VALUES (@animeId, @status, 1, @error, @httpStatus, @fetchedAt, CURRENT_TIMESTAMP)
    ON CONFLICT(anime_id) DO UPDATE SET status = excluded.status, attempts = anime_fetch_status.attempts + 1,
      last_error = excluded.last_error, last_http_status = excluded.last_http_status,
      fetched_at = COALESCE(excluded.fetched_at, anime_fetch_status.fetched_at), updated_at = CURRENT_TIMESTAMP
  `).run({ animeId, status: result, error, httpStatus, fetchedAt });
}

async function fetchAnime(id: number, clientId: string) {
  const response = await fetch(`https://api.myanimelist.net/v2/anime/${id}?fields=${encodeURIComponent(FIELDS)}`, {
    headers: { 'X-MAL-CLIENT-ID': clientId }
  });
  if (response.status === 404) return { response, anime: null };
  if (!response.ok) {
    const message = (await response.text()).slice(0, 500) || `HTTP ${response.status}`;
    throw Object.assign(new Error(message), { httpStatus: response.status });
  }
  return { response, anime: await response.json() as AnimeDetails };
}

function delay(min: number, max: number) {
  const milliseconds = Math.floor(min + Math.random() * (max - min + 1));
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function runSample(config: Options, clientId: string) {
  await createWorkingCopy(config.source, config.database);
  const db = openWorkingDatabase(config.database);
  const end = config.from + config.count - 1;
  const passNumber = ((db.prepare('SELECT MAX(pass_number) AS value FROM crawl_run').get() as { value: number | null }).value ?? 0) + 1;
  const startedAt = new Date().toISOString();
  const run = db.prepare(`
    INSERT INTO crawl_run (pass_number, started_at, status, from_anime_id, to_anime_id)
    VALUES (?, ?, 'running', ?, ?)
  `).run(passNumber, startedAt, config.from, end);
  const runId = Number(run.lastInsertRowid);
  const store = db.transaction((anime: AnimeDetails, fetchedAt: string) => {
    storeAnime(db, anime, fetchedAt);
    recordFetch(db, anime.id, 'fetched', fetchedAt, 200, null);
  });

  console.log(`Sample pass ${passNumber}: anime IDs ${config.from}-${end}, database ${config.database}`);
  try {
    for (let id = config.from; id <= end; id += 1) {
      const existed = Boolean(db.prepare('SELECT 1 FROM anime WHERE id = ?').get(id));
      db.prepare('UPDATE crawl_run SET current_anime_id = ? WHERE id = ?').run(id, runId);
      try {
        const { response, anime } = await fetchAnime(id, clientId);
        if (!anime) {
          recordFetch(db, id, 'not_found', null, response.status, null);
          db.prepare('UPDATE crawl_run SET requests = requests + 1, not_found = not_found + 1 WHERE id = ?').run(runId);
          console.log(`[${id}] 404 not found`);
        } else {
          const fetchedAt = new Date().toISOString();
          store(anime, fetchedAt);
          db.prepare(`UPDATE crawl_run SET requests = requests + 1, refreshed = refreshed + 1,
            discovered = discovered + ? WHERE id = ?`).run(existed ? 0 : 1, runId);
          console.log(`[${id}] 200 ${anime.title} · ${anime.statistics?.num_list_users ?? anime.num_list_users ?? 0} users`);
        }
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        const httpStatus = cause && typeof cause === 'object' && 'httpStatus' in cause ? Number(cause.httpStatus) : null;
        recordFetch(db, id, 'error', null, httpStatus, error);
        db.prepare('UPDATE crawl_run SET requests = requests + 1, errors = errors + 1 WHERE id = ?').run(runId);
        console.error(`[${id}] error: ${error}`);
      }
      if (id < end) await delay(config.minDelayMs, config.maxDelayMs);
    }
    db.prepare(`UPDATE crawl_run SET status = 'completed', completed_at = ?, current_anime_id = ? WHERE id = ?`)
      .run(new Date().toISOString(), end, runId);
  } catch (cause) {
    db.prepare(`UPDATE crawl_run SET status = 'failed', completed_at = ? WHERE id = ?`).run(new Date().toISOString(), runId);
    throw cause;
  } finally {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('journal_mode = DELETE');
    db.close();
  }
}

function openWorkingDatabase(path: string) {
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function crawlState(db: Database.Database, key: string) {
  return (db.prepare('SELECT value FROM crawl_state WHERE key = ?').get(key) as { value?: string } | undefined)?.value ?? null;
}

function setCrawlState(db: Database.Database, key: string, value: string | number) {
  db.prepare(`INSERT INTO crawl_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}

type RunRow = {
  id: number;
  pass_number: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  from_anime_id: number;
  to_anime_id: number;
  current_anime_id: number | null;
  requests: number;
  refreshed: number;
  discovered: number;
  not_found: number;
  errors: number;
  skipped: number;
  phase: 'refresh' | 'discovery' | null;
};

const emptyStatus: CrawlerStatus = {
  state: 'unavailable', phase: null, passNumber: null, currentId: null, scanLimit: null,
  requests: 0, refreshed: 0, discovered: 0, notFound: 0, errors: 0, skipped: 0,
  startedAt: null, completedAt: null, lastRequestAt: null, lastSuccessAt: null,
  nextScheduledAt: null, message: null
};

class Reporter {
  private current: CrawlerStatus = { ...emptyStatus };

  private constructor(private readonly statusPath: string, private readonly logPath: string) {}

  static async create(statusPath: string, logPath: string) {
    const reporter = new Reporter(statusPath, logPath);
    try { reporter.current = { ...emptyStatus, ...JSON.parse(await readFile(statusPath, 'utf8')) as CrawlerStatus }; } catch { /* first run */ }
    return reporter;
  }

  async update(values: Partial<CrawlerStatus>) {
    this.current = { ...this.current, ...values };
    await mkdir(dirname(this.statusPath), { recursive: true });
    const temporary = `${this.statusPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.current, null, 2)}\n`);
    await rename(temporary, this.statusPath);
  }

  async log(message: string) {
    await mkdir(dirname(this.logPath), { recursive: true });
    const line = `${new Date().toISOString()} ${message.replace(/[\r\n]+/g, ' ')}`;
    console.log(line);
    const information = await stat(this.logPath).catch(() => null);
    if (information && information.size >= 5 * 1024 * 1024) {
      await unlink(`${this.logPath}.1`).catch(() => undefined);
      await rename(this.logPath, `${this.logPath}.1`);
    }
    await appendFile(this.logPath, `${line}\n`);
  }
}

function latestRun(db: Database.Database, states = "'running'") {
  return db.prepare(`SELECT * FROM crawl_run WHERE status IN (${states}) ORDER BY id DESC LIMIT 1`).get() as RunRow | undefined;
}

function runStatus(run: RunRow, state: CrawlerStatus['state'], message: string | null = null): Partial<CrawlerStatus> {
  return {
    state,
    phase: run.phase,
    passNumber: run.pass_number,
    currentId: run.current_anime_id,
    scanLimit: run.to_anime_id,
    requests: run.requests,
    refreshed: run.refreshed,
    discovered: run.discovered,
    notFound: run.not_found,
    errors: run.errors,
    skipped: run.skipped,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    message
  };
}

function beginOrResumeRun(db: Database.Database) {
  const existing = latestRun(db);
  if (existing) return existing;
  const passNumber = ((db.prepare('SELECT MAX(pass_number) value FROM crawl_run').get() as { value: number | null }).value ?? 0) + 1;
  const fetchMaximum = (db.prepare('SELECT MAX(anime_id) value FROM anime_fetch_status').get() as { value: number | null }).value ?? 0;
  const storedFrontier = Number(crawlState(db, 'next_anime_id') ?? 1) - 1;
  const scanLimit = Math.max(fetchMaximum, storedFrontier, 1);
  const startedAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO crawl_run (pass_number, started_at, status, from_anime_id, to_anime_id, current_anime_id, phase)
    VALUES (?, ?, 'running', 1, ?, 1, 'refresh')
  `).run(passNumber, startedAt, scanLimit);
  setCrawlState(db, 'crawler_phase', 'refresh');
  setCrawlState(db, 'crawler_next_id', 1);
  setCrawlState(db, 'crawler_scan_limit', scanLimit);
  setCrawlState(db, 'crawler_consecutive_misses', 0);
  return db.prepare('SELECT * FROM crawl_run WHERE id = ?').get(Number(result.lastInsertRowid)) as RunRow;
}

type FetchOutcome = { kind: 'fetched'; anime: AnimeDetails; discovered: boolean } | { kind: 'not_found' } | { kind: 'error'; error: string; httpStatus: number | null };

async function requestAnime(db: Database.Database, id: number, clientId: string): Promise<FetchOutcome> {
  const existed = Boolean(db.prepare('SELECT 1 FROM anime WHERE id = ?').get(id));
  try {
    const { anime } = await fetchAnime(id, clientId);
    if (!anime) return { kind: 'not_found' };
    return { kind: 'fetched', anime, discovered: !existed };
  } catch (cause) {
    return {
      kind: 'error',
      error: cause instanceof Error ? cause.message : String(cause),
      httpStatus: cause && typeof cause === 'object' && 'httpStatus' in cause ? Number(cause.httpStatus) : null
    };
  }
}

function commitOutcome(db: Database.Database, runId: number, id: number, phase: 'refresh' | 'discovery', outcome: FetchOutcome, consecutiveMisses: number) {
  const now = new Date().toISOString();
  let nextMisses = consecutiveMisses;
  const transaction = db.transaction(() => {
    if (outcome.kind === 'fetched') {
      storeAnime(db, outcome.anime, now);
      recordFetch(db, id, 'fetched', now, 200, null);
      db.prepare(`UPDATE crawl_run SET requests = requests + 1, refreshed = refreshed + 1,
        discovered = discovered + ?, current_anime_id = ? WHERE id = ?`).run(outcome.discovered ? 1 : 0, id, runId);
      nextMisses = 0;
    } else if (outcome.kind === 'not_found') {
      recordFetch(db, id, 'not_found', null, 404, null);
      db.prepare('UPDATE crawl_run SET requests = requests + 1, not_found = not_found + 1, current_anime_id = ? WHERE id = ?').run(id, runId);
      nextMisses += 1;
    } else {
      recordFetch(db, id, 'error', null, outcome.httpStatus, outcome.error);
      db.prepare('UPDATE crawl_run SET requests = requests + 1, errors = errors + 1, current_anime_id = ? WHERE id = ?').run(id, runId);
    }
    setCrawlState(db, 'crawler_next_id', id + 1);
    setCrawlState(db, 'last_progress_at', now);
    if (phase === 'discovery') {
      setCrawlState(db, 'next_anime_id', id + 1);
      setCrawlState(db, 'crawler_consecutive_misses', nextMisses);
    }
  });
  transaction();
  return { now, consecutiveMisses: nextMisses };
}

function shouldRefresh(db: Database.Database, id: number, passNumber: number) {
  if (db.prepare('SELECT 1 FROM anime WHERE id = ?').get(id)) return true;
  const status = (db.prepare('SELECT status FROM anime_fetch_status WHERE anime_id = ?').get(id) as { status?: string } | undefined)?.status;
  return status !== 'not_found' || id % 4 === passNumber % 4;
}

async function reportRequest(reporter: Reporter, db: Database.Database, runId: number, id: number, outcome: FetchOutcome, timestamp: string) {
  const run = db.prepare('SELECT * FROM crawl_run WHERE id = ?').get(runId) as RunRow;
  const description = outcome.kind === 'fetched'
    ? `200 #${id} ${outcome.anime.title}${outcome.discovered ? ' (new)' : ''}`
    : outcome.kind === 'not_found' ? `404 #${id}` : `ERROR #${id} ${outcome.httpStatus ?? 'network'} ${outcome.error}`;
  await reporter.log(description);
  await reporter.update({
    ...runStatus(run, 'running'),
    lastRequestAt: timestamp,
    ...(outcome.kind === 'fetched' ? { lastSuccessAt: timestamp } : {}),
    message: description
  });
}

async function runFullPass(config: Options, clientId: string, reporter: Reporter) {
  const resumedWorkingCopy = await exists(config.database);
  await createWorkingCopy(config.source, config.database, true);
  const db = openWorkingDatabase(config.database);
  if (!resumedWorkingCopy) setCrawlState(db, 'crawler_ready_to_publish', 0);
  const publishPending = resumedWorkingCopy && crawlState(db, 'crawler_ready_to_publish') === '1';
  if (publishPending) {
    const completed = latestRun(db, "'completed'");
    if (!completed) {
      db.close();
      throw new Error('Working database is marked for publication without a completed pass.');
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('journal_mode = DELETE');
    db.close();
    if (config.publish) {
      await copyFile(config.source, `${config.source}.previous`);
      await rename(config.database, config.source);
    }
    const nextScheduledAt = new Date(Date.parse(completed.started_at) + config.intervalMs).toISOString();
    await reporter.log(`Published completed pass ${completed.pass_number} after restart recovery.`);
    await reporter.update({ ...runStatus(completed, 'idle', 'Pass completed successfully.'), phase: 'waiting', nextScheduledAt });
    return;
  }
  const run = beginOrResumeRun(db);
  const runId = run.id;
  let phase = (crawlState(db, 'crawler_phase') ?? run.phase ?? 'refresh') as 'refresh' | 'discovery';
  let nextId = Number(crawlState(db, 'crawler_next_id') ?? 1);
  const scanLimit = Number(crawlState(db, 'crawler_scan_limit') ?? run.to_anime_id);
  let consecutiveMisses = Number(crawlState(db, 'crawler_consecutive_misses') ?? 0);
  await reporter.log(`${run.status === 'running' && nextId > 1 ? 'Resuming' : 'Starting'} pass ${run.pass_number} at #${nextId} (${phase}).`);
  await reporter.update({ ...runStatus(run, 'running'), phase, scanLimit, nextScheduledAt: null });

  try {
    if (phase === 'refresh') {
      for (let id = nextId; id <= scanLimit; id += 1) {
        if (!shouldRefresh(db, id, run.pass_number)) {
          db.transaction(() => {
            db.prepare('UPDATE crawl_run SET skipped = skipped + 1, current_anime_id = ? WHERE id = ?').run(id, runId);
            setCrawlState(db, 'crawler_next_id', id + 1);
          })();
          if (id % 250 === 0) {
            const current = db.prepare('SELECT * FROM crawl_run WHERE id = ?').get(runId) as RunRow;
            await reporter.update({ ...runStatus(current, 'running'), message: `Skipping cached 404s near #${id}` });
          }
          continue;
        }
        const outcome = await requestAnime(db, id, clientId);
        const committed = commitOutcome(db, runId, id, 'refresh', outcome, 0);
        await reportRequest(reporter, db, runId, id, outcome, committed.now);
        await delay(config.minDelayMs, config.maxDelayMs);
      }
      phase = 'discovery';
      nextId = Math.max(Number(crawlState(db, 'next_anime_id') ?? scanLimit + 1), scanLimit + 1);
      consecutiveMisses = 0;
      db.transaction(() => {
        db.prepare("UPDATE crawl_run SET phase = 'discovery', current_anime_id = ? WHERE id = ?").run(nextId, runId);
        setCrawlState(db, 'crawler_phase', 'discovery');
        setCrawlState(db, 'crawler_next_id', nextId);
        setCrawlState(db, 'crawler_consecutive_misses', 0);
      })();
      await reporter.log(`Refresh complete; discovering from #${nextId}.`);
    }

    while (consecutiveMisses < config.missLimit) {
      const id = nextId;
      const outcome = await requestAnime(db, id, clientId);
      const committed = commitOutcome(db, runId, id, 'discovery', outcome, consecutiveMisses);
      consecutiveMisses = committed.consecutiveMisses;
      nextId = id + 1;
      await reportRequest(reporter, db, runId, id, outcome, committed.now);
      if (consecutiveMisses < config.missLimit) await delay(config.minDelayMs, config.maxDelayMs);
    }

    const integrity = db.pragma('integrity_check') as { integrity_check: string }[];
    const foreignKeys = db.pragma('foreign_key_check') as unknown[];
    if (integrity.some((row) => row.integrity_check !== 'ok') || foreignKeys.length) throw new Error('Database validation failed after the crawler pass.');
    const completedAt = new Date().toISOString();
    db.transaction(() => {
      db.prepare("UPDATE crawl_run SET status = 'completed', completed_at = ?, current_anime_id = ? WHERE id = ?").run(completedAt, nextId - 1, runId);
      setCrawlState(db, 'crawler_ready_to_publish', 1);
    })();
    const completed = db.prepare('SELECT * FROM crawl_run WHERE id = ?').get(runId) as RunRow;
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('journal_mode = DELETE');
    db.close();

    if (config.publish) {
      await copyFile(config.source, `${config.source}.previous`);
      await rename(config.database, config.source);
    }
    const nextScheduledAt = new Date(Date.parse(completed.started_at) + config.intervalMs).toISOString();
    await reporter.log(`Completed pass ${completed.pass_number}: ${completed.refreshed} refreshed, ${completed.discovered} new, ${completed.not_found} not found, ${completed.errors} errors.`);
    await reporter.update({
      ...runStatus(completed, 'idle', 'Pass completed successfully.'),
      phase: 'waiting',
      completedAt,
      nextScheduledAt
    });
  } catch (cause) {
    if (db.open) db.close();
    const message = cause instanceof Error ? cause.message : String(cause);
    await reporter.log(`FATAL ${message}`);
    await reporter.update({ state: 'failed', message });
    throw cause;
  }
}

function lastCompletedRun(path: string) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crawl_run'").get();
    if (!exists) return undefined;
    return latestRun(db, "'completed'");
  } finally { db.close(); }
}

async function waitUntilDue(config: Options, reporter: Reporter) {
  if (await exists(config.database)) return;
  const previous = lastCompletedRun(config.source);
  if (!previous) return;
  const due = Date.parse(previous.started_at) + config.intervalMs;
  while (Date.now() < due) {
    await reporter.update({
      ...runStatus(previous, 'idle', 'Waiting for the next weekly pass.'),
      phase: 'waiting',
      nextScheduledAt: new Date(due).toISOString()
    });
    await delay(Math.min(due - Date.now(), 60_000), Math.min(due - Date.now(), 60_000));
  }
}

async function main() {
  const config = options(process.argv.slice(2));
  const clientId = process.env.MAL_CLIENT_ID?.trim();
  if (!clientId) throw new Error('MAL_CLIENT_ID is required');
  if (config.mode === 'sample') return runSample(config, clientId);

  const reporter = await Reporter.create(config.statusFile, config.logFile);
  do {
    await waitUntilDue(config, reporter);
    await runFullPass(config, clientId, reporter);
  } while (config.schedule === 'continuous');
}

await main();
