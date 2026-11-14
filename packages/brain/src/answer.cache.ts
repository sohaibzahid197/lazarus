/**
 * Default in-memory Answer_Cache: least-recently-used eviction over a Map.
 * Map iteration order is insertion order, so the first key is the least
 * recently used entry once hits are re-inserted.
 */
import { CACHE_MAX_ENTRIES } from './answer.texts.js';
import type { AnswerCache } from './answer.types.js';

interface CacheEntry {
  readonly value: string;
  readonly expiresAt: number;
}

export function createMemoryCache(maxEntries: number = CACHE_MAX_ENTRIES): AnswerCache {
  const entries = new Map<string, CacheEntry>();

  function get(key: string, now: number): string | undefined {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    entries.delete(key);
    if (entry.expiresAt <= now) return undefined;
    entries.set(key, entry);
    return entry.value;
  }

  function set(key: string, value: string, expiresAt: number): void {
    entries.delete(key);
    entries.set(key, { value, expiresAt });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done === true) break;
      entries.delete(oldest.value);
    }
  }

  function size(): number {
    return entries.size;
  }

  return { get, set, size };
}
