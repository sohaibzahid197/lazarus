// Example tests for the Answer_Service (task 12.20).
// _Requirements: 7.11, 13.7_
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './ai.mock.js';
import type { MockStep } from './ai.mock.js';
import { AI_ERROR_KINDS, AiError } from './ai.types.js';
import type { AiErrorKind } from './ai.types.js';
import { createMemoryCache } from './answer.cache.js';
import { buildCacheKey } from './answer.key.js';
import { answerQuestion, checkScam } from './answer.service.js';
import { CACHE_TTL_MS, CALL_TIMEOUT_MS, FIXED_TEXTS } from './answer.texts.js';
import type { AnswerCache, AnswerDeps, Language, ScamVerdict } from './answer.types.js';
import { splitSms } from './index.js';
import { LANGUAGES } from './router.types.js';

const START = 1_000_000;

function makeDeps(steps: readonly MockStep[], cache: AnswerCache = createMemoryCache()) {
  const client = createMockClient(steps);
  const time = { now: START };
  const deps: AnswerDeps = { client, cache, clock: () => time.now };
  return { client, cache, time, deps };
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const EXPECTED_CALLS: Readonly<Record<AiErrorKind, number>> = {
  quota: 1,
  unknown: 1,
  timeout: 2,
  network: 2,
};

describe('each AiError kind returns the Try_Later_Text', () => {
  for (const kind of AI_ERROR_KINDS) {
    it(`question: ${kind}`, async () => {
      const { client, cache, deps } = makeDeps([{ error: new AiError(kind, 'secret detail') }]);
      const reply = await answerQuestion(deps, 'How do I plant wheat?', 'en');
      expect(reply).toBe(FIXED_TEXTS.en.tryLater);
      expect(reply).not.toContain('secret detail');
      expect(client.calls).toHaveLength(EXPECTED_CALLS[kind]);
      expect(cache.size()).toBe(0);
    });

    it(`scam: ${kind}`, async () => {
      const { client, cache, deps } = makeDeps([{ error: new AiError(kind) }]);
      const reply = await checkScam(deps, 'You won a prize, send the code', 'en');
      expect(reply).toBe(FIXED_TEXTS.en.tryLater);
      expect(client.calls).toHaveLength(EXPECTED_CALLS[kind]);
      expect(cache.size()).toBe(0);
    });
  }
});

describe('8 s timeout with a hanging client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out at the default 8000 ms, retries once, then gives the Try_Later_Text', async () => {
    const { client, cache, deps } = makeDeps([{ hang: true }]);
    let settled: string | null = null;
    void answerQuestion(deps, 'How do I plant wheat?', 'en').then((r) => {
      settled = r;
    });

    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS - 1);
    expect(settled).toBeNull();
    expect(client.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(client.calls).toHaveLength(2);
    expect(settled).toBeNull();

    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
    expect(settled).toBe(FIXED_TEXTS.en.tryLater);
    expect(client.calls).toHaveLength(2);
    expect(cache.size()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('cache hit and expiry', () => {
  it('a repeated question is answered from the cache', async () => {
    const { client, deps } = makeDeps([{ text: 'Sow in November.' }, { text: 'Other answer.' }]);
    const first = await answerQuestion(deps, 'When to sow wheat?', 'en');
    const second = await answerQuestion(deps, '  WHEN to sow   wheat? ', 'en');
    expect(first).toBe('Sow in November.');
    expect(second).toBe(first);
    expect(client.calls).toHaveLength(1);
  });

  it('an entry is a hit just before the TTL and a miss once the TTL elapses', async () => {
    const { client, time, deps } = makeDeps([{ text: 'Sow in November.' }, { text: 'Fresh answer.' }]);
    await answerQuestion(deps, 'When to sow wheat?', 'en');

    time.now = START + CACHE_TTL_MS - 1;
    expect(await answerQuestion(deps, 'When to sow wheat?', 'en')).toBe('Sow in November.');
    expect(client.calls).toHaveLength(1);

    time.now = START + CACHE_TTL_MS;
    expect(await answerQuestion(deps, 'When to sow wheat?', 'en')).toBe('Fresh answer.');
    expect(client.calls).toHaveLength(2);
  });
});

interface LanguageCase {
  readonly language: Language;
  readonly plain: string;
  readonly health: string;
  readonly live: string;
  readonly model: string;
}

const LANGUAGE_CASES: readonly LanguageCase[] = [
  {
    language: 'en',
    plain: 'How do I plant wheat?',
    health: 'I have a fever, what helps?',
    live: 'Will the weather be good today?',
    model: 'Rest and drink water.',
  },
  {
    language: 'roman-ur',
    plain: 'Gandum kaise boyein?',
    health: 'Mujhe bukhar hai, kya karun?',
    live: 'Aaj mausam kaisa hoga?',
    model: 'Aaram karein aur pani piyein.',
  },
  {
    language: 'ur',
    plain: 'گندم کیسے بوئیں؟',
    health: 'مجھے بخار ہے، کیا کروں؟',
    live: 'آج موسم کیسا ہوگا؟',
    model: 'آرام کریں اور پانی پئیں۔',
  },
];

describe('each Language', () => {
  for (const c of LANGUAGE_CASES) {
    const texts = FIXED_TEXTS[c.language];

    it(`${c.language}: Try_Later_Text on failure fits one SMS part`, async () => {
      const { deps } = makeDeps([{ error: new AiError('unknown') }]);
      const reply = await answerQuestion(deps, c.plain, c.language);
      expect(reply).toBe(texts.tryLater);
      expect(splitSms(reply)).toHaveLength(1);
    });

    it(`${c.language}: blank input gives the prompt texts without an AI call`, async () => {
      const { client, deps } = makeDeps([{ text: 'unused' }]);
      expect(await answerQuestion(deps, ' \t\n ', c.language)).toBe(texts.promptForQuestion);
      expect(await checkScam(deps, '   ', c.language)).toBe(texts.promptForScamText);
      expect(client.calls).toHaveLength(0);
    });

    it(`${c.language}: a health question carries the referral once`, async () => {
      const { deps } = makeDeps([{ text: c.model }]);
      const reply = await answerQuestion(deps, c.health, c.language);
      expect(reply.startsWith(c.model)).toBe(true);
      expect(count(reply, texts.referral.health)).toBe(1);
    });

    it(`${c.language}: a live-fact question carries the Uncertainty_Note once`, async () => {
      const { deps } = makeDeps([{ text: c.model }]);
      const reply = await answerQuestion(deps, c.live, c.language);
      expect(reply.startsWith(c.model)).toBe(true);
      expect(count(reply, texts.uncertainty)).toBe(1);
    });
  }
});

const SCAM_VERDICTS: readonly ScamVerdict[] = ['SCAM', 'SAFE', 'UNSURE'];

describe('each Scam_Verdict', () => {
  for (const language of LANGUAGES) {
    for (const verdict of SCAM_VERDICTS) {
      it(`${language}: model ${verdict} is printed with the localized word`, async () => {
        const { deps } = makeDeps([{ text: `${verdict}: short reason here` }]);
        const reply = await checkScam(deps, 'You won a prize, send the code', language);
        expect(reply).toBe(`${FIXED_TEXTS[language].scamWord[verdict]}: short reason here`);
      });
    }
  }

  it('a verdict without a Reason uses the fixed Reason', async () => {
    const { deps } = makeDeps([{ text: 'SAFE:' }]);
    const reply = await checkScam(deps, 'Your parcel arrives today', 'en');
    expect(reply).toBe(`SAFE: ${FIXED_TEXTS.en.scamReason.SAFE}`);
  });

  it('unparseable output gives UNSURE with the unparseable Reason', async () => {
    const { deps } = makeDeps([{ text: 'no verdict here' }]);
    const reply = await checkScam(deps, 'Your parcel arrives today', 'en');
    expect(reply).toBe(`UNSURE: ${FIXED_TEXTS.en.scamReason.unparseable}`);
  });
});

interface StubCall {
  readonly op: 'get' | 'set';
  readonly key: string;
  readonly value?: string;
  readonly time: number;
}

function createStubCache(): AnswerCache & { readonly calls: readonly StubCall[] } {
  const calls: StubCall[] = [];
  const store = new Map<string, string>();
  return {
    calls,
    get(key: string, now: number): string | undefined {
      calls.push({ op: 'get', key, time: now });
      return store.get(key);
    },
    set(key: string, value: string, expiresAt: number): void {
      calls.push({ op: 'set', key, value, time: expiresAt });
      store.set(key, value);
    },
    size(): number {
      return store.size;
    },
  };
}

describe('host-supplied cache stub', () => {
  it('receives every read and write of a question', async () => {
    const stub = createStubCache();
    const { client, deps } = makeDeps([{ text: 'Sow in November.' }], stub);
    const key = buildCacheKey('question', 'en', 'When to sow wheat?');

    const first = await answerQuestion(deps, 'When to sow wheat?', 'en');
    const second = await answerQuestion(deps, 'When to sow wheat?', 'en');

    expect(second).toBe(first);
    expect(client.calls).toHaveLength(1);
    expect(stub.calls).toEqual([
      { op: 'get', key, time: START },
      { op: 'set', key, value: first, time: START + CACHE_TTL_MS },
      { op: 'get', key, time: START },
    ]);
  });

  it('receives every read and write of a scam check', async () => {
    const stub = createStubCache();
    const { deps } = makeDeps([{ text: 'SCAM: asks for your code' }], stub);
    const key = buildCacheKey('scam', 'en', 'Send me your OTP');

    const reply = await checkScam(deps, 'Send me your OTP', 'en');

    expect(reply).toBe('SCAM: asks for your code');
    expect(stub.calls).toEqual([
      { op: 'get', key, time: START },
      { op: 'set', key, value: reply, time: START + CACHE_TTL_MS },
    ]);
  });
});

describe('throwing collaborators', () => {
  it('a throwing cache counts as a miss and a skipped write', async () => {
    const throwing: AnswerCache = {
      get: () => {
        throw new Error('get failed');
      },
      set: () => {
        throw new Error('set failed');
      },
      size: () => 0,
    };
    const { client, deps } = makeDeps(
      [{ text: 'Sow in November.' }, { text: 'SCAM: asks for your code' }],
      throwing,
    );
    expect(await answerQuestion(deps, 'When to sow wheat?', 'en')).toBe('Sow in November.');
    expect(await checkScam(deps, 'Send me your OTP', 'en')).toBe('SCAM: asks for your code');
    expect(client.calls).toHaveLength(2);
  });

  it('a throwing clock counts as a miss and a skipped write', async () => {
    const cache = createMemoryCache();
    const client = createMockClient([{ text: 'Sow in November.' }]);
    const deps: AnswerDeps = {
      client,
      cache,
      clock: () => {
        throw new Error('clock failed');
      },
    };
    expect(await answerQuestion(deps, 'When to sow wheat?', 'en')).toBe('Sow in November.');
    expect(await answerQuestion(deps, 'When to sow wheat?', 'en')).toBe('Sow in November.');
    expect(client.calls).toHaveLength(2);
    expect(cache.size()).toBe(0);
  });
});
