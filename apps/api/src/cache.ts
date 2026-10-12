import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

type CacheEntry<T> = { value: T; expiresAt: number };

export class LruCache<T> {
  private readonly values = new Map<string, CacheEntry<T>>();

  constructor(private readonly capacity = 200) {}

  get(key: string) {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    this.values.delete(key);
    this.values.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number) {
    this.values.delete(key);
    this.values.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.values.size > this.capacity) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }
}

export function sendJson(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
  cacheControl: string
) {
  const body = JSON.stringify(payload);
  const etag = `\"${createHash('sha256').update(body).digest('base64url')}\"`;
  reply.header('Cache-Control', cacheControl).header('ETag', etag).type('application/json');
  if (request.headers['if-none-match'] === etag) return reply.code(304).send();
  return reply.send(body);
}

export const PUBLIC_CACHE = 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800';
export const PRIVATE_CACHE = 'private, max-age=300, stale-while-revalidate=3600';
