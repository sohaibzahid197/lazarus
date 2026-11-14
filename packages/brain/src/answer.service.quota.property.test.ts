// Quota cache re-check of the Answer_Service (Property 30).
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMockClient } from './ai.mock.js';
import { AiError, type AiErrorKind } from './ai.types.js';
import {
  aiErrorKindArb,
  anyInputTextArb,
  languageArb,
  PBT_OPTIONS,
} from './answer.arbitraries.js';
import { answerQuestion, checkScam } from './answer.service.js';
import { FIXED_TEXTS } from './answer.texts.js';
import type { AnswerCache, AnswerDeps, Language, RequestKind } from './answer.types.js';
import { normalizeMessage } from './normalize.js';

/** Small per-call timeout so a stuck attempt cannot slow the run. */
const TIMEOUT_MS = 50;

interface ScriptedCache extends AnswerCache {
  readonly getCalls: number;
  readonly setCalls: number;
}

/** A cache whose `get` returns `script[n]` on call n (undefined past the end) and counts calls. */
function scriptedCache(script: readonly (string | undefined)[]): ScriptedCache {
  let getCalls = 0;
  let setCalls = 0;
  return {
    get getCalls() {
      return getCalls;
    },
    get setCalls() {
      return setCalls;
    },
    get(): string | undefined {
      const value = script[getCalls];
      getCalls += 1;
      return value;
    },
    set(): void {
      setCalls += 1;
    },
    size: () => 0,
  };
}

function ask(deps: AnswerDeps, kind: RequestKind, text: string, language: Language): Promise<string> {
  return kind === 'question'
    ? answerQuestion(deps, text, language)
    : checkScam(deps, text, language);
}

const kindArb: fc.Arbitrary<RequestKind> = fc.constantFrom<RequestKind>('question', 'scam');

/** Input that is not blank after normalization, so the cache and AI path is taken. */
const nonBlankTextArb: fc.Arbitrary<string> = anyInputTextArb.filter(
  (t) => normalizeMessage(t) !== '',
);

/** A non-blank cache entry. */
const entryArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim() !== '');

/** What the second cache read returns: a miss or a non-blank entry. */
const recheckArb: fc.Arbitrary<string | undefined> = fc.option(entryArb, { nil: undefined });

const nonQuotaKindArb: fc.Arbitrary<AiErrorKind> = aiErrorKindArb.filter((k) => k !== 'quota');

const CALLS_BY_KIND: Readonly<Record<AiErrorKind, number>> = {
  quota: 1,
  unknown: 1,
  timeout: 2,
  network: 2,
};

describe('Answer_Service quota properties', () => {
  // Feature: ai-answer-service, Property 30: Quota re-checks the cache exactly once
  describe('Property 30: Quota re-checks the cache exactly once', () => {
    /** **Validates: Requirements 7.2, 8.1, 8.9, 13.18** */
    it('a quota rejection reads the cache twice and calls the AI once', async () => {
      await fc.assert(
        fc.asyncProperty(
          kindArb,
          nonBlankTextArb,
          languageArb,
          recheckArb,
          async (kind, text, language, recheck) => {
            const cache = scriptedCache([undefined, recheck]);
            const client = createMockClient([{ error: new AiError('quota') }]);
            const deps: AnswerDeps = { client, cache, clock: () => 0, timeoutMs: TIMEOUT_MS };

            const reply = await ask(deps, kind, text, language);

            expect(cache.getCalls).toBe(2);
            expect(client.calls).toHaveLength(1);
            expect(cache.setCalls).toBe(0);
            expect(reply).toBe(recheck ?? FIXED_TEXTS[language].tryLater);
          },
        ),
        PBT_OPTIONS,
      );
    });

    /** **Validates: Requirements 7.2, 8.1, 8.9, 13.18** */
    it('any other failure kind reads the cache once and gives the Try_Later_Text', async () => {
      await fc.assert(
        fc.asyncProperty(
          kindArb,
          nonBlankTextArb,
          languageArb,
          nonQuotaKindArb,
          entryArb,
          async (kind, text, language, errorKind, entry) => {
            // An entry waits at the second read; it must never be read.
            const cache = scriptedCache([undefined, entry]);
            const client = createMockClient([{ error: new AiError(errorKind) }]);
            const deps: AnswerDeps = { client, cache, clock: () => 0, timeoutMs: TIMEOUT_MS };

            const reply = await ask(deps, kind, text, language);

            expect(cache.getCalls).toBe(1);
            expect(client.calls).toHaveLength(CALLS_BY_KIND[errorKind]);
            expect(cache.setCalls).toBe(0);
            expect(reply).toBe(FIXED_TEXTS[language].tryLater);
          },
        ),
        PBT_OPTIONS,
      );
    });
  });
});
