// Property-based tests for the in-memory Answer_Cache (`answer.cache.ts`).
//
// Model-based: every operation is applied both to `createMemoryCache(n)` and
// to a small reference LRU in which a cache hit counts as use and an expired
// entry is dropped when read. Each property runs at least 100 fast-check
// iterations (PBT_OPTIONS).
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createMemoryCache } from './answer.cache.js';
import { CACHE_MAX_ENTRIES } from './answer.texts.js';
import { PBT_OPTIONS } from './answer.arbitraries.js';
import type { AnswerCache } from './answer.types.js';

type CacheOp =
  | { readonly type: 'get'; readonly key: string; readonly now: number }
  | { readonly type: 'set'; readonly key: string; readonly value: string; readonly expiresAt: number };

interface ModelEntry {
  readonly key: string;
  readonly value: string;
  readonly expiresAt: number;
}

/** Reference LRU: array ordered from least to most recently used. */
class ReferenceLru {
  private entries: ModelEntry[] = [];

  constructor(private readonly capacity: number) {}

  get(key: string, now: number): string | undefined {
    const index = this.entries.findIndex((e) => e.key === key);
    if (index < 0) return undefined;
    const [entry] = this.entries.splice(index, 1);
    if (entry === undefined || entry.expiresAt <= now) return undefined;
    this.entries.push(entry);
    return entry.value;
  }

  set(key: string, value: string, expiresAt: number): void {
    this.entries = this.entries.filter((e) => e.key !== key);
    this.entries.push({ key, value, expiresAt });
    while (this.entries.length > this.capacity) this.entries.shift();
  }

  size(): number {
    return this.entries.length;
  }

  keys(): readonly string[] {
    return this.entries.map((e) => e.key);
  }
}

/** Small time range so both live and expired reads happen often. */
const timeArb = fc.integer({ min: 0, max: 20 });

function opArb(keyArb: fc.Arbitrary<string>): fc.Arbitrary<CacheOp> {
  return fc.oneof(
    fc.record({ type: fc.constant('get' as const), key: keyArb, now: timeArb }),
    fc.record({
      type: fc.constant('set' as const),
      key: keyArb,
      value: fc.string({ maxLength: 8 }),
      expiresAt: timeArb,
    }),
  );
}

function applyAndCompare(cache: AnswerCache, model: ReferenceLru, op: CacheOp, capacity: number): void {
  if (op.type === 'get') {
    expect(cache.get(op.key, op.now)).toBe(model.get(op.key, op.now));
  } else {
    cache.set(op.key, op.value, op.expiresAt);
    model.set(op.key, op.value, op.expiresAt);
  }
  expect(cache.size()).toBe(model.size());
  expect(cache.size()).toBeLessThanOrEqual(capacity);
}

/** The entries present match: probe each model key in LRU order (same effect on both). */
function expectSameContents(cache: AnswerCache, model: ReferenceLru): void {
  const earliest = Number.NEGATIVE_INFINITY;
  for (const key of model.keys()) {
    const expected = model.get(key, earliest);
    expect(expected).toBeDefined();
    expect(cache.get(key, earliest)).toBe(expected);
  }
  expect(cache.size()).toBe(model.size());
}

describe('Answer_Cache properties', () => {
  // Feature: ai-answer-service, Property 15: The cache is bounded and evicts least recently used
  // **Validates: Requirements 7.8, 7.9**
  it('Property 15: small capacities stay bounded and match a reference LRU', () => {
    const keyArb = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.array(opArb(keyArb), { maxLength: 80 }),
        (capacity, ops) => {
          const cache = createMemoryCache(capacity);
          const model = new ReferenceLru(capacity);
          for (const op of ops) applyAndCompare(cache, model, op, capacity);
          expectSameContents(cache, model);
        },
      ),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 15: The cache is bounded and evicts least recently used
  // **Validates: Requirements 7.8, 7.9**
  it('Property 15: the default 500 bound stays bounded and matches a reference LRU', () => {
    expect(CACHE_MAX_ENTRIES).toBe(500);
    const keyArb = fc.integer({ min: 0, max: 539 }).map((n) => `k${String(n)}`);
    // Pre-fill with distinct live keys so later operations cross the bound.
    const prefill = Array.from({ length: CACHE_MAX_ENTRIES }, (_, i) => `k${String(i)}`);
    fc.assert(
      fc.property(fc.array(opArb(keyArb), { minLength: 1, maxLength: 120 }), (ops) => {
        const cache = createMemoryCache();
        const model = new ReferenceLru(CACHE_MAX_ENTRIES);
        for (const key of prefill) {
          applyAndCompare(cache, model, { type: 'set', key, value: key, expiresAt: 100 }, CACHE_MAX_ENTRIES);
        }
        for (const op of ops) applyAndCompare(cache, model, op, CACHE_MAX_ENTRIES);
        expectSameContents(cache, model);
      }),
      PBT_OPTIONS,
    );
  });
});
