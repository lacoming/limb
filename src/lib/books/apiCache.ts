/**
 * Simple in-memory cache for API responses.
 * Single Map, TTL 10 min. Used to reduce requests to Open Library / Google Books.
 */
const TTL_MS = 10 * 60 * 1000;
const IS_DEV = process.env.NODE_ENV === "development";

interface CacheEntry {
  ts: number;
  data: unknown;
}

const cache = new Map<string, CacheEntry>();

export function getCache<T>(key: string): T | null {
  if (IS_DEV) return null;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache(key: string, data: unknown): void {
  if (IS_DEV) return;
  cache.set(key, { ts: Date.now(), data });
}
