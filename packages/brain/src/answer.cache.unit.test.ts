// Unit tests for createMemoryCache.
// _Requirements: 7.4, 7.8, 7.9_
import { describe, it, expect } from 'vitest';
import { createMemoryCache } from './answer.cache.js';
import { buildCacheKey } from './answer.key.js';
import { CACHE_MAX_ENTRIES } from './answer.texts.js';

describe('createMemoryCache', () => {
  it('holds at most 500 entries by default', () => {
    expect(CACHE_MAX_ENTRIES).toBe(500);
    const cache = createMemoryCache();
    for (let i = 0; i < 501; i += 1) cache.set(`k${String(i)}`, 'v', 1000);
    expect(cache.size()).toBe(500);
    expect(cache.get('k0', 0)).toBeUndefined();
    expect(cache.get('k1', 0)).toBe('v');
    expect(cache.get('k500', 0)).toBe('v');
  });

  it('keeps an entry live at expiresAt - 1 and missing at expiresAt', () => {
    const cache = createMemoryCache();
    cache.set('a', 'reply', 100);
    expect(cache.get('a', 99)).toBe('reply');
    expect(cache.get('a', 100)).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('treats an entry as missing after expiry', () => {
    const cache = createMemoryCache();
    cache.set('a', 'reply', 100);
    expect(cache.get('a', 101)).toBeUndefined();
  });

  it('overwriting a key keeps one entry with the new value and expiry', () => {
    const cache = createMemoryCache();
    cache.set('a', 'old', 100);
    cache.set('a', 'new', 200);
    expect(cache.size()).toBe(1);
    expect(cache.get('a', 150)).toBe('new');
  });

  it('a read marks the entry most recently used for eviction', () => {
    const cache = createMemoryCache(2);
    cache.set('a', 'A', 1000);
    cache.set('b', 'B', 1000);
    expect(cache.get('a', 0)).toBe('A');
    cache.set('c', 'C', 1000);
    expect(cache.size()).toBe(2);
    expect(cache.get('b', 0)).toBeUndefined();
    expect(cache.get('a', 0)).toBe('A');
    expect(cache.get('c', 0)).toBe('C');
  });

  it('evicts the oldest entry when nothing was read', () => {
    const cache = createMemoryCache(2);
    cache.set('a', 'A', 1000);
    cache.set('b', 'B', 1000);
    cache.set('c', 'C', 1000);
    expect(cache.get('a', 0)).toBeUndefined();
    expect(cache.get('b', 0)).toBe('B');
  });

  it('works with keys from buildCacheKey', () => {
    const cache = createMemoryCache();
    cache.set(buildCacheKey('question', 'en', 'What is rain?'), 'Water from clouds.', 100);
    expect(cache.get(buildCacheKey('question', 'en', '  what IS rain? '), 50)).toBe('Water from clouds.');
    expect(cache.get(buildCacheKey('scam', 'en', 'What is rain?'), 50)).toBeUndefined();
  });
});
