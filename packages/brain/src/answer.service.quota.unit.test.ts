// Example tests for the `quota` cache re-check (design key decision 8): the
// Answer_Cache is read first, and once more after a `quota` rejection.
// _Requirements: 7.2, 8.1, 8.9, 13.18_
import { describe, expect, it } from 'vitest';
import { createMockClient, type MockClient } from './ai.mock.js';
import { AiError } from './ai.types.js';
import { answerQuestion, checkScam } from './answer.service.js';
import { FIXED_TEXTS } from './answer.texts.js';
import type { AnswerCache, AnswerDeps } from './answer.types.js';

const NOW = 1_700_000_000_000;

interface GetCall {
  readonly key: string;
  readonly now: number;
}

interface FakeCache extends AnswerCache {
  readonly gets: readonly GetCall[];
  readonly setCount: () => number;
}

/**
 * Fake Answer_Cache. The n-th `get` returns `script[n]` (undefined past the
 * end), standing in for an unexpired entry or a miss. Counts every call.
 */
function createFakeCache(script: readonly (string | undefined)[]): FakeCache {
  const gets: GetCall[] = [];
  let sets = 0;
  return {
    gets,
    setCount: () => sets,
    get(key, now) {
      const result = script[gets.length];
      gets.push({ key, now });
      return result;
    },
    set() {
      sets += 1;
    },
    size: () => 0,
  };
}

interface Harness {
  readonly deps: AnswerDeps;
  readonly cache: FakeCache;
  readonly client: MockClient;
}

function quotaHarness(script: readonly (string | undefined)[]): Harness {
  const cache = createFakeCache(script);
  const client = createMockClient([{ error: new AiError('quota') }]);
  return { deps: { client, cache, clock: () => NOW }, cache, client };
}

/** Both reads use the same Cache_Key; the AI_Client is called once. */
function expectReadTwiceCalledOnce(h: Harness): void {
  expect(h.cache.gets).toHaveLength(2);
  expect(h.cache.gets[1]?.key).toBe(h.cache.gets[0]?.key);
  expect(h.client.calls).toHaveLength(1);
}

describe('Answer_Service re-checks the Answer_Cache after a quota rejection', () => {
  it('answerQuestion returns the entry that appears at the re-check', async () => {
    const entry = 'Islamabad is the capital of Pakistan.';
    const h = quotaHarness([undefined, entry]);
    const reply = await answerQuestion(h.deps, 'What is the capital of Pakistan?', 'en');
    expect(reply).toBe(entry);
    expectReadTwiceCalledOnce(h);
  });

  it('checkScam returns the entry that appears at the re-check', async () => {
    const entry = 'SCAM: Real offices never ask for your PIN by SMS.';
    const h = quotaHarness([undefined, entry]);
    const reply = await checkScam(h.deps, 'You WON a prize! Send your PIN to claim it.', 'en');
    expect(reply).toBe(entry);
    expectReadTwiceCalledOnce(h);
  });

  it('answerQuestion returns the Try_Later_Text when the re-check also misses', async () => {
    const h = quotaHarness([undefined, undefined]);
    const reply = await answerQuestion(h.deps, 'What is the capital of Pakistan?', 'en');
    expect(reply).toBe(FIXED_TEXTS.en.tryLater);
    expectReadTwiceCalledOnce(h);
    expect(h.cache.setCount()).toBe(0);
  });

  it('checkScam returns the Try_Later_Text when the re-check also misses', async () => {
    const h = quotaHarness([undefined, undefined]);
    const reply = await checkScam(h.deps, 'You WON a prize! Send your PIN to claim it.', 'en');
    expect(reply).toBe(FIXED_TEXTS.en.tryLater);
    expectReadTwiceCalledOnce(h);
    expect(h.cache.setCount()).toBe(0);
  });
});
