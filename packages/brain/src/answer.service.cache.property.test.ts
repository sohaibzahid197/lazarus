// Cache behavior of the Answer_Service (Properties 12, 13, 14).
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMockClient, type MockClient, type MockStep } from './ai.mock.js';
import type { AiClient, Prompt } from './ai.types.js';
import {
  anyInputTextArb,
  blankTextArb,
  failingStep,
  languageArb,
  PBT_OPTIONS,
  reasonArb,
  scamVerdictArb,
  usableTextStepArb,
} from './answer.arbitraries.js';
import { createMemoryCache } from './answer.cache.js';
import { answerQuestion, checkScam } from './answer.service.js';
import { stripMarkdown } from './answer.text.js';
import { CACHE_TTL_MS } from './answer.texts.js';
import type { AnswerCache, AnswerDeps, Language, RequestKind } from './answer.types.js';
import { normalizeMessage } from './normalize.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface Harness {
  readonly deps: AnswerDeps;
  readonly client: MockClient;
  readonly cache: AnswerCache;
}

/** Fresh Mock_Client, memory cache and a clock fixed at `now`. */
function makeHarness(steps: readonly MockStep[], now: number): Harness {
  const client = createMockClient(steps);
  const cache = createMemoryCache();
  const deps: AnswerDeps = { client, cache, clock: () => now };
  return { deps, client, cache };
}

/** Runs one request of the given kind. */
function ask(
  deps: AnswerDeps,
  kind: RequestKind,
  text: string,
  language: Language | undefined,
): Promise<string> {
  return kind === 'question'
    ? answerQuestion(deps, text, language)
    : checkScam(deps, text, language);
}

/** Input text that is not blank after normalization, so the AI path is taken. */
const nonBlankTextArb: fc.Arbitrary<string> = anyInputTextArb.filter(
  (t) => normalizeMessage(t) !== '',
);

/** Optional supplied Language; `undefined` means the service detects it. */
const optionalLanguageArb: fc.Arbitrary<Language | undefined> = fc.option(languageArb, {
  nil: undefined,
});

const kindArb: fc.Arbitrary<RequestKind> = fc.constantFrom<RequestKind>('question', 'scam');

/** A `VERDICT: reason` shaped model output. */
const scamShapedStepArb: fc.Arbitrary<MockStep> = fc
  .tuple(scamVerdictArb, reasonArb)
  .map(([verdict, reason]) => ({ text: `${verdict}: ${reason}` }));

/** Model output usable by both request kinds. */
const usableStepArb: fc.Arbitrary<MockStep> = fc.oneof(usableTextStepArb, scamShapedStepArb);

/** A fixed clock value; every call in a run happens at this instant, well within the TTL. */
const nowArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 4_000_000_000_000 });

/** Shortest system-prompt echo that counts as a leak (Requirement 11.4). */
const LEAK_MIN_CHARS = 40;

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('Answer_Service cache properties', () => {
  // Feature: ai-answer-service, Property 12: Repeated questions call the AI once
  describe('Property 12: Repeated questions call the AI once', () => {
    /** **Validates: Requirements 7.2, 7.10, 9.11** */
    it('asking twice within the TTL calls the AI once and returns equal replies', async () => {
      await fc.assert(
        fc.asyncProperty(
          kindArb,
          nonBlankTextArb,
          optionalLanguageArb,
          usableStepArb,
          nowArb,
          async (kind, text, language, step, now) => {
            const { deps, client, cache } = makeHarness([step], now);
            const first = await ask(deps, kind, text, language);
            expect(client.calls).toHaveLength(1);
            // Model text rejected by post-processing is not cached (Property 13).
            fc.pre(cache.size() === 1);

            const second = await ask(deps, kind, text, language);
            expect(client.calls).toHaveLength(1);
            expect(second).toBe(first);
            expect(cache.size()).toBe(1);
          },
        ),
        PBT_OPTIONS,
      );
    });

    /** **Validates: Requirements 7.2, 7.10, 9.11** */
    it('question and scam requests for the same text use different keys', async () => {
      await fc.assert(
        fc.asyncProperty(
          kindArb,
          nonBlankTextArb,
          languageArb,
          usableStepArb,
          nowArb,
          async (firstKind, text, language, step, now) => {
            const otherKind: RequestKind = firstKind === 'question' ? 'scam' : 'question';
            const { deps, client, cache } = makeHarness([step], now);

            const first = await ask(deps, firstKind, text, language);
            fc.pre(cache.size() === 1);

            // The cached reply of the other kind must not answer this request.
            const other = await ask(deps, otherKind, text, language);
            expect(client.calls).toHaveLength(2);
            expect(client.calls[0]?.system).not.toBe(client.calls[1]?.system);
            fc.pre(cache.size() === 2);

            // Both entries now answer repeats without a further AI call.
            expect(await ask(deps, firstKind, text, language)).toBe(first);
            expect(await ask(deps, otherKind, text, language)).toBe(other);
            expect(client.calls).toHaveLength(2);
            expect(cache.size()).toBe(2);
          },
        ),
        PBT_OPTIONS,
      );
    });
  });

  // Feature: ai-answer-service, Property 13: Failures never touch the cache
  describe('Property 13: Failures never touch the cache', () => {
    /** Small real-timer timeout so `hang` steps settle in a few ms. */
    const FAILURE_TIMEOUT_MS = 2;

    interface Seed {
      readonly key: string;
      readonly value: string;
    }

    /**
     * Pre-existing entries. Keys start with `seed:`, which no real key
     * (a JSON array) can match, so seeds never answer the request.
     */
    const seedsArb: fc.Arbitrary<readonly Seed[]> = fc.uniqueArray(
      fc.record({
        key: fc.string({ maxLength: 20 }).map((k) => `seed:${k}`),
        value: fc.string({ minLength: 1, maxLength: 40 }).filter((v) => v.trim() !== ''),
      }),
      { maxLength: 5, selector: (s) => s.key },
    );

    interface Watched {
      readonly cache: AnswerCache;
      readonly writes: () => number;
    }

    /** Memory cache pre-seeded with `seeds`, counting every `set` after seeding. */
    function watchedCache(seeds: readonly Seed[], now: number): Watched {
      const inner = createMemoryCache();
      for (const seed of seeds) inner.set(seed.key, seed.value, now + CACHE_TTL_MS);
      let writes = 0;
      const cache: AnswerCache = {
        get: (key, at) => inner.get(key, at),
        set: (key, value, expiresAt) => {
          writes += 1;
          inner.set(key, value, expiresAt);
        },
        size: () => inner.size(),
      };
      return { cache, writes: () => writes };
    }

    /** Count and contents are exactly the seeds, and no write happened. */
    function expectUntouched(watched: Watched, seeds: readonly Seed[], now: number): void {
      expect(watched.writes()).toBe(0);
      expect(watched.cache.size()).toBe(seeds.length);
      for (const seed of seeds) expect(watched.cache.get(seed.key, now)).toBe(seed.value);
    }

    /** A client that answers with a slice of at least 40 chars of its own system prompt. */
    function echoClient(startSeed: number, lengthSeed: number): AiClient & {
      readonly calls: readonly Prompt[];
    } {
      const calls: Prompt[] = [];
      return {
        calls,
        complete(prompt: Prompt): Promise<string> {
          calls.push(prompt);
          const system = prompt.system;
          const minLen = Math.min(LEAK_MIN_CHARS, system.length);
          const len = minLen + (lengthSeed % (system.length - minLen + 1));
          const start = startSeed % (system.length - len + 1);
          return Promise.resolve(system.slice(start, start + len));
        },
      };
    }

    /** Model text made only of markdown markers and whitespace: blank after stripMarkdown. */
    const markerOnlyTextArb: fc.Arbitrary<string> = fc
      .string({ unit: fc.constantFrom('*', '**', '#', '## ', '_', '`', ' ', '\n', '- '), maxLength: 20 })
      .filter((t) => stripMarkdown(t) === '');

    /** **Validates: Requirements 1.4, 7.6, 9.10** */
    it('every failing client script leaves the cache unchanged', async () => {
      await fc.assert(
        fc.asyncProperty(
          kindArb,
          nonBlankTextArb,
          optionalLanguageArb,
          fc.array(failingStep({ hang: true }), { minLength: 1, maxLength: 2 }),
          seedsArb,
          nowArb,
          async (kind, text, language, steps, seeds, now) => {
            const watched = watchedCache(seeds, now);
            const client = createMockClient(steps);
            const deps: AnswerDeps = {
              client,
              cache: watched.cache,
              clock: () => now,
              timeoutMs: FAILURE_TIMEOUT_MS,
            };
            await ask(deps, kind, text, language);
            expect(client.calls.length).toBeGreaterThanOrEqual(1);
            expectUntouched(watched, seeds, now);
          },
        ),
        PBT_OPTIONS,
      );
    });

    /** **Validates: Requirements 1.4, 7.6, 9.10** */
    it('model text that is blank after stripMarkdown leaves the cache unchanged', async () => {
      await fc.assert(
        fc.asyncProperty(
          kindArb,
          nonBlankTextArb,
          optionalLanguageArb,
          markerOnlyTextArb,
          seedsArb,
          nowArb,
          async (kind, text, language, modelText, seeds, now) => {
            const watched = watchedCache(seeds, now);
            const client = createMockClient([{ text: modelText }]);
            const deps: AnswerDeps = { client, cache: watched.cache, clock: () => now };
            await ask(deps, kind, text, language);
            expect(client.calls).toHaveLength(1);
            expectUntouched(watched, seeds, now);
          },
        ),
        PBT_OPTIONS,
      );
    });

    /** **Validates: Requirements 1.4, 7.6, 9.10** */
    it('model text echoing the system prompt leaves the cache unchanged', async () => {
      await fc.assert(
        fc.asyncProperty(
          kindArb,
          nonBlankTextArb,
          optionalLanguageArb,
          fc.nat(),
          fc.nat(),
          seedsArb,
          nowArb,
          async (kind, text, language, startSeed, lengthSeed, seeds, now) => {
            const watched = watchedCache(seeds, now);
            const client = echoClient(startSeed, lengthSeed);
            const deps: AnswerDeps = { client, cache: watched.cache, clock: () => now };
            await ask(deps, kind, text, language);
            expect(client.calls).toHaveLength(1);
            expect(client.calls[0]?.system.length ?? 0).toBeGreaterThanOrEqual(LEAK_MIN_CHARS);
            expectUntouched(watched, seeds, now);
          },
        ),
        PBT_OPTIONS,
      );
    });

    /** **Validates: Requirements 1.4, 7.6, 9.10** */
    it('blank input makes no AI call and leaves the cache unchanged', async () => {
      await fc.assert(
        fc.asyncProperty(
          kindArb,
          blankTextArb,
          optionalLanguageArb,
          usableStepArb,
          seedsArb,
          nowArb,
          async (kind, text, language, step, seeds, now) => {
            const watched = watchedCache(seeds, now);
            const client = createMockClient([step]);
            const deps: AnswerDeps = { client, cache: watched.cache, clock: () => now };
            await ask(deps, kind, text, language);
            expect(client.calls).toHaveLength(0);
            expectUntouched(watched, seeds, now);
          },
        ),
        PBT_OPTIONS,
      );
    });
  });

  // Feature: ai-answer-service, Property 14: Cache entries live exactly 24 hours
  describe('Property 14: Cache entries live exactly 24 hours', () => {
    interface ClockHarness extends Harness {
      readonly clock: { now: number };
    }

    /** Fresh Mock_Client and memory cache with a mutable fake clock starting at `start`. */
    function makeClockHarness(steps: readonly MockStep[], start: number): ClockHarness {
      const clock = { now: start };
      const client = createMockClient(steps);
      const cache = createMemoryCache();
      const deps: AnswerDeps = { client, cache, clock: () => clock.now };
      return { deps, client, cache, clock };
    }

    /** Offsets strictly inside the TTL, including 0 and TTL - 1. */
    const withinTtlArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: CACHE_TTL_MS - 1 });

    /** Offsets at or past the TTL, including exactly TTL. */
    const pastTtlArb: fc.Arbitrary<number> = fc.integer({
      min: CACHE_TTL_MS,
      max: CACHE_TTL_MS * 30,
    });

    /** **Validates: Requirements 7.3, 7.4** */
    it('a stored reply is served without an AI call before the TTL ends', async () => {
      await fc.assert(
        fc.asyncProperty(
          kindArb,
          nonBlankTextArb,
          optionalLanguageArb,
          usableStepArb,
          usableStepArb,
          nowArb,
          withinTtlArb,
          async (kind, text, language, stepA, stepB, start, offset) => {
            const { deps, client, cache, clock } = makeClockHarness([stepA, stepB], start);
            const first = await ask(deps, kind, text, language);
            fc.pre(cache.size() === 1);

            clock.now = start + offset;
            const second = await ask(deps, kind, text, language);
            expect(client.calls).toHaveLength(1);
            expect(second).toBe(first);
            expect(cache.size()).toBe(1);
          },
        ),
        PBT_OPTIONS,
      );
    });

    /** **Validates: Requirements 7.3, 7.4** */
    it('at or after the TTL the entry is a miss and is replaced by the new reply', async () => {
      await fc.assert(
        fc.asyncProperty(
          kindArb,
          nonBlankTextArb,
          optionalLanguageArb,
          usableStepArb,
          usableStepArb,
          nowArb,
          pastTtlArb,
          async (kind, text, language, stepA, stepB, start, offset) => {
            const { deps, client, cache, clock } = makeClockHarness([stepA, stepB], start);
            const first = await ask(deps, kind, text, language);
            fc.pre(cache.size() === 1);

            clock.now = start + offset;
            const second = await ask(deps, kind, text, language);
            expect(client.calls).toHaveLength(2);
            // Only a usable second reply replaces the entry; a distinct one makes the swap observable.
            fc.pre(cache.size() === 1 && second !== first);

            const third = await ask(deps, kind, text, language);
            expect(client.calls).toHaveLength(2);
            expect(third).toBe(second);
            expect(cache.size()).toBe(1);
          },
        ),
        PBT_OPTIONS,
      );
    });
  });
});
