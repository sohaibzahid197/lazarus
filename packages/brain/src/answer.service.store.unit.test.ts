// Example tests: after a successful call the Answer_Cache holds the returned
// Reply_Text under the expected Cache_Key, expiring at clock() + CACHE_TTL_MS.
// _Requirements: 7.3, 12.4, 13.16_
import { describe, expect, it } from 'vitest';
import { createMockClient, type MockStep } from './ai.mock.js';
import { createMemoryCache } from './answer.cache.js';
import { buildCacheKey } from './answer.key.js';
import { answerQuestion, checkScam } from './answer.service.js';
import { CACHE_TTL_MS, MAX_QUESTION_CODE_POINTS } from './answer.texts.js';
import type { AnswerCache, AnswerDeps, Language, RequestKind } from './answer.types.js';
import { normalizeMessage } from './normalize.js';

const NOW = 1_700_000_000_000;

interface SetCall {
  readonly key: string;
  readonly value: string;
  readonly expiresAt: number;
}

interface RecordingCache extends AnswerCache {
  readonly sets: readonly SetCall[];
}

/** Wraps a real memory cache and records every `set` call. */
function createRecordingCache(inner: AnswerCache): RecordingCache {
  const sets: SetCall[] = [];
  return {
    sets,
    get: (key, now) => inner.get(key, now),
    set(key, value, expiresAt) {
      sets.push({ key, value, expiresAt });
      inner.set(key, value, expiresAt);
    },
    size: () => inner.size(),
  };
}

interface Harness {
  readonly deps: AnswerDeps;
  readonly memory: AnswerCache;
  readonly recording: RecordingCache;
}

function makeHarness(steps: readonly MockStep[]): Harness {
  const memory = createMemoryCache();
  const recording = createRecordingCache(memory);
  const deps: AnswerDeps = { client: createMockClient(steps), cache: recording, clock: () => NOW };
  return { deps, memory, recording };
}

/** Cache_Key from the normalized text truncated to MAX_QUESTION_CODE_POINTS. */
function expectedKey(kind: RequestKind, language: Language, input: string): string {
  const text = Array.from(normalizeMessage(input)).slice(0, MAX_QUESTION_CODE_POINTS).join('');
  return buildCacheKey(kind, language, text);
}

function expectStored(h: Harness, key: string, reply: string): void {
  expect(h.recording.sets).toEqual([{ key, value: reply, expiresAt: NOW + CACHE_TTL_MS }]);
  expect(h.memory.size()).toBe(1);
  expect(h.memory.get(key, NOW + CACHE_TTL_MS - 1)).toBe(reply);
  expect(h.memory.get(key, NOW + CACHE_TTL_MS)).toBeUndefined();
}

describe('Answer_Service stores the Reply_Text in the Answer_Cache', () => {
  it('answerQuestion stores the returned reply under the question key', async () => {
    const h = makeHarness([{ text: 'Islamabad is the capital of Pakistan.' }]);
    const question = '  What is the CAPITAL   of Pakistan?  ';
    const reply = await answerQuestion(h.deps, question, 'en');
    expect(reply.trim()).not.toBe('');
    expectStored(h, expectedKey('question', 'en', question), reply);
  });

  it('answerQuestion stores a long question under the truncated-text key', async () => {
    const h = makeHarness([{ text: 'That is a long question. Please ask a shorter one.' }]);
    const question = `What is ${'x'.repeat(MAX_QUESTION_CODE_POINTS + 100)}`;
    const reply = await answerQuestion(h.deps, question, 'en');
    const key = expectedKey('question', 'en', question);
    expect(key).not.toBe(buildCacheKey('question', 'en', question));
    expectStored(h, key, reply);
  });

  it('checkScam stores the returned reply under the scam key', async () => {
    const h = makeHarness([{ text: 'SCAM: Real offices never ask for your PIN by SMS.' }]);
    const argument = 'You WON a prize! Send your PIN to claim it.';
    const reply = await checkScam(h.deps, argument, 'en');
    expect(reply.trim()).not.toBe('');
    expectStored(h, expectedKey('scam', 'en', argument), reply);
  });

  it('checkScam stores under the supplied Language', async () => {
    const h = makeHarness([{ text: 'SAFE: Yeh aam paighaam lagta hai.' }]);
    const argument = 'Kal milte hain bazaar mein';
    const reply = await checkScam(h.deps, argument, 'roman-ur');
    expectStored(h, expectedKey('scam', 'roman-ur', argument), reply);
  });
});
