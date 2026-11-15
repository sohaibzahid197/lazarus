import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryCache, createMockClient, isCanonicalNumber, type AiClient } from '@lazarus/brain';
import { TEST_KEY } from '../test/pbt';
import { createAiSetup, type AiFactories } from './ai';
import { readCappedBody } from './body';
import { clientIpFrom } from './clientIp';
import { readGeminiEnv } from './env';
import { letters, messageIdFor } from './messageId';
import { SIMULATOR_NUMBER } from './simulatorNumber';

const MAX_BYTES = 16_384;

type ClientEnv = Parameters<AiFactories['createClient']>[0];

// Next.js types make NODE_ENV required on ProcessEnv.
function envOf(vars: Record<string, string>): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test', ...vars };
}

function countingFactories(): { factories: AiFactories; clientEnvs: ClientEnv[]; caches: number[] } {
  const clientEnvs: ClientEnv[] = [];
  const caches: number[] = [];
  const factories: AiFactories = {
    createClient: (env): AiClient => {
      clientEnvs.push(env);
      return createMockClient([{ text: 'ok' }]);
    },
    createCache: () => {
      caches.push(1);
      return createMemoryCache();
    },
  };
  return { factories, clientEnvs, caches };
}

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[i];
      i += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
  });
}

function streamRequest(chunks: readonly Uint8Array[], headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/ouija', {
    method: 'POST',
    body: streamOf(chunks),
    headers,
    duplex: 'half',
  } as RequestInit);
}

describe('SIMULATOR_NUMBER', () => {
  it('is the fixed fictional canonical number of design C2', () => {
    expect(SIMULATOR_NUMBER).toBe('+999666000000666');
    expect(isCanonicalNumber(SIMULATOR_NUMBER)).toBe(true);
  });
});

describe('readGeminiEnv', () => {
  it('gives no key and no model when both are missing', () => {
    expect(readGeminiEnv(envOf({}))).toEqual({ apiKey: null, model: undefined });
  });

  it('treats an empty or whitespace-only key as no key', () => {
    expect(readGeminiEnv(envOf({ GEMINI_API_KEY: '' })).apiKey).toBeNull();
    expect(readGeminiEnv(envOf({ GEMINI_API_KEY: '  \t\n' })).apiKey).toBeNull();
  });

  it('keeps a set key exactly as given', () => {
    expect(readGeminiEnv(envOf({ GEMINI_API_KEY: TEST_KEY })).apiKey).toBe(TEST_KEY);
  });

  it('leaves the model undefined when empty or whitespace, and trims a set model', () => {
    expect(readGeminiEnv(envOf({ GEMINI_MODEL: '' })).model).toBeUndefined();
    expect(readGeminiEnv(envOf({ GEMINI_MODEL: '   ' })).model).toBeUndefined();
    expect(readGeminiEnv(envOf({ GEMINI_MODEL: '  gemini-test  ' })).model).toBe('gemini-test');
  });
});

describe('createAiSetup', () => {
  it('creates no client and no cache without a key', () => {
    const { factories, clientEnvs, caches } = countingFactories();
    const setup = createAiSetup({ apiKey: null, model: 'gemini-test' }, factories);
    expect(setup).toEqual({ answer: null, secrets: [] });
    expect(clientEnvs).toHaveLength(0);
    expect(caches).toHaveLength(0);
  });

  it('creates exactly one client and one cache with a key, and lists the key as a secret', () => {
    const { factories, clientEnvs, caches } = countingFactories();
    const setup = createAiSetup({ apiKey: TEST_KEY, model: undefined }, factories);
    expect(clientEnvs).toEqual([{ GEMINI_API_KEY: TEST_KEY }]);
    expect(caches).toHaveLength(1);
    expect(setup.secrets).toEqual([TEST_KEY]);
    expect(setup.answer?.secrets).toEqual([TEST_KEY]);
    expect(setup.answer?.client).toBeDefined();
    expect(setup.answer?.cache).toBeDefined();
  });

  it('passes a set model to the client factory', () => {
    const { factories, clientEnvs } = countingFactories();
    createAiSetup({ apiKey: TEST_KEY, model: 'gemini-test' }, factories);
    expect(clientEnvs).toEqual([{ GEMINI_API_KEY: TEST_KEY, GEMINI_MODEL: 'gemini-test' }]);
  });
});

describe('getAiSetup', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns the same setup object on every call of one instance', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.resetModules();
    const { getAiSetup } = await import('./ai');
    const first = getAiSetup();
    expect(first.answer).toBeNull();
    expect(getAiSetup()).toBe(first);
  });
});

describe('clientIpFrom', () => {
  it('is unknown when x-forwarded-for is missing or its first entry is empty', () => {
    expect(clientIpFrom(new Headers())).toBe('unknown');
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': ' , b' }))).toBe('unknown');
  });

  it('takes the first entry, trimmed', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': 'a, b' }))).toBe('a');
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '  203.0.113.7 ,198.51.100.1' }))).toBe('203.0.113.7');
  });
});

describe('readCappedBody', () => {
  it('rejects a declared content-length above the cap without reading', async () => {
    const req = new Request('http://localhost/api/ouija', {
      method: 'POST',
      body: 'x',
      headers: { 'content-length': String(MAX_BYTES + 1) },
    });
    expect(await readCappedBody(req, MAX_BYTES)).toEqual({ ok: false });
  });

  it('rejects a 16,385-byte stream with no content-length', async () => {
    const req = streamRequest([new Uint8Array(10_000), new Uint8Array(6_385)]);
    expect(req.headers.get('content-length')).toBeNull();
    expect(await readCappedBody(req, MAX_BYTES)).toEqual({ ok: false });
  });

  it('rejects a 16,385-byte stream with a false small content-length', async () => {
    const req = streamRequest([new Uint8Array(MAX_BYTES + 1)], { 'content-length': '10' });
    expect(await readCappedBody(req, MAX_BYTES)).toEqual({ ok: false });
  });

  it('accepts a body of exactly the cap and decodes UTF-8', async () => {
    // 'مدد' is 3 characters of 2 UTF-8 bytes each.
    const text = 'مدد' + 'a'.repeat(MAX_BYTES - 6);
    const bytes = new TextEncoder().encode(text);
    expect(bytes.byteLength).toBe(MAX_BYTES);
    const req = streamRequest([bytes.slice(0, 1), bytes.slice(1)]);
    expect(await readCappedBody(req, MAX_BYTES)).toEqual({ ok: true, text });
  });

  it('reads an empty body as empty text', async () => {
    const req = new Request('http://localhost/api/ouija', { method: 'POST' });
    expect(await readCappedBody(req, MAX_BYTES)).toEqual({ ok: true, text: '' });
  });
});

describe('messageIdFor', () => {
  it('writes base 26 with a to z', () => {
    expect(letters(0)).toBe('a');
    expect(letters(25)).toBe('z');
    expect(letters(26)).toBe('ba');
  });

  it('is deterministic and holds no digit', () => {
    const times = [0, 1, 1_767_225_600_000, Number.MAX_SAFE_INTEGER];
    for (const t of times) {
      for (const count of [0, 1, 5, 120]) {
        const id = messageIdFor(t, count);
        expect(id).toBe(messageIdFor(t, count));
        expect(id).not.toMatch(/\d/);
      }
    }
  });

  it('keeps the Reminder_Id r:<id> at most 20 characters for times up to 2^53 - 1', () => {
    expect(`r:${messageIdFor(Number.MAX_SAFE_INTEGER, 120)}`.length).toBeLessThanOrEqual(20);
  });
});
