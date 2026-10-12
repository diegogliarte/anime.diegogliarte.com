import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { FranchiseScope } from '@youranimelist/shared';
import { LruCache, PRIVATE_CACHE, PUBLIC_CACHE, sendJson } from './cache.js';
import { getAnimePage, getFacets, getMissingEntries, getRecommendations } from './catalog.js';
import { databaseRevision, getFranchise } from './database.js';
import { fetchUserList } from './mal.js';

const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });
const origins = (process.env.CORS_ORIGINS ?? 'https://anime.diegogliarte.com,http://localhost:5173').split(',').map((value) => value.trim());
await app.register(cors, { origin: origins, methods: ['GET', 'POST', 'OPTIONS'] });

const responseCache = new LruCache<unknown>(300);

app.get('/health', async () => ({ ok: true, revision: databaseRevision }));

app.get('/v1/facets', async (request, reply) => {
  const key = `facets:${databaseRevision}`;
  let result = responseCache.get(key);
  if (!result) { result = getFacets(); responseCache.set(key, result, 60 * 60_000); }
  return sendJson(request, reply, result, PUBLIC_CACHE);
});

app.get('/v1/anime', async (request, reply) => {
  const query = request.query as Record<string, string | undefined>;
  const key = `anime:${databaseRevision}:${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined) as [string, string][]).toString()}`;
  let result = responseCache.get(key);
  if (!result) { result = getAnimePage(query); responseCache.set(key, result, 5 * 60_000); }
  return sendJson(request, reply, result, PUBLIC_CACHE);
});

app.get('/v1/franchises/:id', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  const scopeValue = (request.query as { scope?: string }).scope;
  const scope: FranchiseScope = scopeValue === 'core' || scopeValue === 'all' ? scopeValue : 'expanded';
  if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Invalid anime ID' });
  const key = `franchise:${databaseRevision}:${id}:${scope}`;
  let result = responseCache.get(key) as ReturnType<typeof getFranchise> | undefined;
  if (!result) { result = getFranchise(id, scope); if (result) responseCache.set(key, result, 60 * 60_000); }
  if (!result) return reply.code(404).send({ error: 'Anime not found' });
  return sendJson(request, reply, { seedId: id, scope, revision: databaseRevision, ...result }, PUBLIC_CACHE);
});

app.get('/v1/recommendations/:id', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'Invalid anime ID' });
  const key = `recommendations:${databaseRevision}:${id}`;
  let result = responseCache.get(key) as ReturnType<typeof getRecommendations> | undefined;
  if (!result) { result = getRecommendations(id); if (result) responseCache.set(key, result, 60 * 60_000); }
  if (!result) return reply.code(404).send({ error: 'Anime not found' });
  return sendJson(request, reply, result, PUBLIC_CACHE);
});

app.post('/v1/missing', async (request, reply) => {
  const body = request.body as { animeIds?: unknown } | null;
  const ids = Array.isArray(body?.animeIds) ? [...new Set(body.animeIds.filter((id): id is number => Number.isInteger(id) && Number(id) > 0))] : [];
  if (!ids.length) return reply.code(400).send({ error: 'animeIds is required' });
  const key = `missing:${databaseRevision}:${ids.slice().sort((a, b) => a - b).join(',')}`;
  let result = responseCache.get(key);
  if (!result) { result = { items: getMissingEntries(ids), revision: databaseRevision }; responseCache.set(key, result, 30 * 60_000); }
  return sendJson(request, reply, result, PRIVATE_CACHE);
});

app.get('/v1/users/:username/list', async (request, reply) => {
  const username = decodeURIComponent((request.params as { username: string }).username).trim();
  if (!username) return reply.code(400).send({ error: 'Username is required' });
  try {
    return sendJson(request, reply, await fetchUserList(username), PRIVATE_CACHE);
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({ error: error instanceof Error ? error.message : 'Unable to load MAL list' });
  }
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
await app.listen({ port, host });
