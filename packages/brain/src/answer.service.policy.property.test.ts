import * as fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './ai.mock.js';
import type { MockStep } from './ai.mock.js';
import {
  PBT_OPTIONS,
  anyInputTextArb,
  clientScript,
  languageArb,
  mixedScriptText,
  modelOutputArb,
  scamResultArb,
  secretsArb,
} from './answer.arbitraries.js';
import { createMemoryCache } from './answer.cache.js';
import { buildCacheKey } from './answer.key.js';
import { buildPrompt } from './answer.prompt.js';
import type { PromptOptions } from './answer.prompt.js';
import { maskPhoneNumbers, redactSecrets } from './answer.redact.js';
import { parseScam, printScam } from './answer.scam.js';
import { answerQuestion, checkScam } from './answer.service.js';
import { hasPromptLeak, shortenToFit, stripMarkdown } from './answer.text.js';
import { CALL_TIMEOUT_MS, FIXED_TEXTS } from './answer.texts.js';
import {
  asksForLiveFacts,
  asksForPriceOrRate,
  classifyTopic,
  containsUnsupportedAmount,
} from './answer.topic.js';
import type { AnswerDeps, Language, RequestKind, Topic } from './answer.types.js';
import { resolveModel } from './models.js';
import { normalizeMessage } from './normalize.js';

type Service = (deps: AnswerDeps, text: string, language?: Language) => Promise<string>;

const SERVICES: readonly (readonly [string, Service])[] = [
  ['answerQuestion', answerQuestion],
  ['checkScam', checkScam],
];

/** How one step ends a call: fine (resolves), fatal (no retry) or retryable. */
type StepClass = 'resolves' | 'fatal' | 'retryable';

function classify(step: MockStep): StepClass {
  if ('error' in step) {
    return step.error.kind === 'timeout' || step.error.kind === 'network' ? 'retryable' : 'fatal';
  }
  if ('reject' in step || 'throws' in step) return 'fatal';
  if ('hang' in step) return 'retryable';
  return 'resolves'; // text (usable or blank) or a non-string value
}

/** Mock_Client semantics: steps are used in order and the last step repeats. */
function stepAt(script: readonly MockStep[], index: number): MockStep {
  const step = script[Math.min(index, script.length - 1)];
  if (step === undefined) throw new Error('empty script');
  return step;
}

interface Expected {
  readonly calls: number;
  readonly failed: boolean;
}

function expectedOutcome(script: readonly MockStep[]): Expected {
  const first = classify(stepAt(script, 0));
  if (first !== 'retryable') return { calls: 1, failed: first === 'fatal' };
  return { calls: 2, failed: classify(stepAt(script, 1)) !== 'resolves' };
}

const questionArb: fc.Arbitrary<string> = mixedScriptText({ minLength: 1, maxLength: 80 }).filter(
  (q) => normalizeMessage(q) !== '',
);

describe('answer service call policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Feature: ai-answer-service, Property 16: Retry policy depends on the error kind
  // **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6, 8.7**
  it.each(SERVICES)('%s: retry policy depends on the error kind', async (_name, service) => {
    await fc.assert(
      fc.asyncProperty(
        clientScript({ hang: true }),
        questionArb,
        languageArb,
        async (script, question, language) => {
          const client = createMockClient(script);
          const deps: AnswerDeps = { client, cache: createMemoryCache(), clock: () => 0 };
          const expected = expectedOutcome(script);

          const pending = service(deps, question, language);
          if ('hang' in stepAt(script, 0)) {
            // No second call before the first attempt has timed out.
            await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS - 1);
            expect(client.calls).toHaveLength(1);
          }
          await vi.runAllTimersAsync();
          const reply = await pending;

          expect(client.calls).toHaveLength(expected.calls);
          if (expected.failed) expect(reply).toBe(FIXED_TEXTS[language].tryLater);
        },
      ),
      PBT_OPTIONS,
    );
  });
});

/** Calls `fn` twice and asserts both results are deeply equal; returns the first. */
function twice<T>(fn: () => T): T {
  const first = fn();
  expect(fn()).toStrictEqual(first);
  return first;
}
const topicArb: fc.Arbitrary<Topic | null> = fc.constantFrom<Topic | null>(
  'health',
  'legal',
  'money',
  null,
);
const kindArb: fc.Arbitrary<RequestKind> = fc.constantFrom<RequestKind>('question', 'scam');
const promptOptionsArb: fc.Arbitrary<PromptOptions> = fc.record({
  kind: kindArb,
  language: languageArb,
  topic: topicArb,
  liveFacts: fc.boolean(),
});
const optionalString: fc.Arbitrary<string | undefined> = fc.option(fc.string({ maxLength: 30 }), {
  nil: undefined,
});
/** Caller-supplied data of one service call, without the client, cache and clock. */
interface CallerData {
  readonly text: string;
  readonly language: Language | undefined;
  readonly secrets: readonly string[] | undefined;
  readonly timeoutMs: number | undefined;
  readonly depKeys: readonly string[];
}
function snapshot(deps: AnswerDeps, text: string, language: Language | undefined): CallerData {
  return {
    text,
    language,
    secrets: deps.secrets === undefined ? undefined : [...deps.secrets],
    timeoutMs: deps.timeoutMs,
    depKeys: Object.keys(deps).sort(),
  };
}
describe('answer helpers purity and input immutability', () => {
  // Feature: ai-answer-service, Property 27: Helpers are pure and inputs are not mutated
  // **Validates: Requirements 12.1, 12.4, 13.16**
  it('pure helpers give equal output twice and do not mutate frozen inputs', () => {
    fc.assert(
      fc.property(
        anyInputTextArb,
        modelOutputArb,
        languageArb,
        promptOptionsArb,
        scamResultArb,
        secretsArb,
        kindArb,
        fc.tuple(mixedScriptText({ maxLength: 60 }), mixedScriptText({ maxLength: 10 })),
        fc.tuple(optionalString, optionalString),
        (text, model, language, options, result, secrets, kind, [suffix, prefix], [opt, env]) => {
          const frozenOptions = Object.freeze({ ...options });
          const frozenResult = Object.freeze({ ...result });
          const frozenSecrets = Object.freeze([...secrets]);
          const prompt = twice(() => buildPrompt(text, frozenOptions));
          twice(() => classifyTopic(text, language));
          twice(() => asksForLiveFacts(text, language));
          twice(() => asksForPriceOrRate(text, language));
          twice(() => containsUnsupportedAmount(model, text));
          twice(() => parseScam(model, language));
          twice(() => printScam(frozenResult, language));
          twice(() => redactSecrets(model, frozenSecrets));
          twice(() => maskPhoneNumbers(model));
          twice(() => buildCacheKey(kind, language, text));
          twice(() => stripMarkdown(model));
          twice(() => shortenToFit(model, suffix, prefix));
          twice(() => hasPromptLeak(model, prompt.system));
          twice(() => resolveModel(opt, env));
          expect(frozenOptions).toEqual(options);
          expect(frozenResult).toEqual(result);
          expect(frozenSecrets).toEqual(secrets);
        },
      ),
      PBT_OPTIONS,
    );
  });
  // Feature: ai-answer-service, Property 27: Helpers are pure and inputs are not mutated
  // **Validates: Requirements 12.1, 12.4, 13.16**
  it.each(SERVICES)('%s does not mutate caller inputs', async (_name, service) => {
    await fc.assert(
      fc.asyncProperty(
        clientScript(),
        anyInputTextArb,
        fc.option(languageArb, { nil: undefined }),
        fc.option(secretsArb, { nil: undefined }),
        fc.option(fc.integer({ min: 1000, max: CALL_TIMEOUT_MS }), { nil: undefined }),
        async (script, text, language, secrets, timeoutMs) => {
          const client = createMockClient(script);
          // The Answer_Cache is excluded: storing the Reply_Text is the intended effect.
          const cache = createMemoryCache();
          const clock = (): number => 0;
          const deps: AnswerDeps = {
            client,
            cache,
            clock,
            ...(secrets === undefined ? {} : { secrets }),
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
          };
          const before = snapshot(deps, text, language);
          const secretsRef = deps.secrets;
          const scriptBefore = script.map((step) => ({ ...step }));
          await service(deps, text, language);
          expect(snapshot(deps, text, language)).toStrictEqual(before);
          expect(deps.secrets).toBe(secretsRef);
          expect(deps.client).toBe(client);
          expect(deps.cache).toBe(cache);
          expect(deps.clock).toBe(clock);
          expect(script.map((step) => ({ ...step }))).toStrictEqual(scriptBefore);
        },
      ),
      PBT_OPTIONS,
    );
  });
});
