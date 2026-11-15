// Example tests for the React Native Gemini adapter with a fake `fetch`.
// No network: every client gets an injected `fetch`.
// Validates: Requirements 16.1, 16.14, 16.17
import { afterEach, describe, expect, it } from 'vitest';
import { AiError, type Prompt } from './ai.types.js';
import { createGeminiClient, GeminiHttpError, type FetchLike } from './gemini.native.js';
import { DEFAULT_GEMINI_MODEL } from './models.js';

const KEY = 'native-secret-key-987';
const PROMPT: Prompt = { system: 'Answer briefly.', user: '<<<what is rain>>>' };

type FetchInit = Parameters<FetchLike>[1];
type FetchResponse = Awaited<ReturnType<FetchLike>>;

interface FetchCall {
  readonly url: string;
  readonly init: FetchInit;
}

function jsonResponse(status: number, body: unknown): FetchResponse {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function fakeFetch(respond: () => Promise<FetchResponse>): { fetch: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return respond();
  };
  return { fetch, calls };
}

function okBody(text: string): unknown {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

async function rejection(promise: Promise<unknown>): Promise<AiError> {
  const result = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(result).toBeInstanceOf(AiError);
  return result as AiError;
}

function setup(respond: () => Promise<FetchResponse>, requestTimeoutMs?: number) {
  const fake = fakeFetch(respond);
  const logs: string[] = [];
  const client = createGeminiClient({
    env: { GEMINI_API_KEY: KEY },
    fetch: fake.fetch,
    log: (line) => logs.push(line),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  });
  return { ...fake, logs, client };
}

describe('gemini.native: request shape (Requirement 16.1)', () => {
  it('posts to the default model URL with the key only in the header', async () => {
    const { client, calls } = setup(() => Promise.resolve(jsonResponse(200, okBody('Rain is water.'))));
    const reply = await client.complete(PROMPT);

    expect(reply).toBe('Rain is water.');
    expect(calls).toHaveLength(1);
    const [call] = calls;
    if (call === undefined) throw new Error('no fetch call');
    expect(call.url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`,
    );
    expect(call.url).not.toContain(KEY);
    expect(call.init.method).toBe('POST');
    expect(call.init.headers).toEqual({ 'content-type': 'application/json', 'x-goog-api-key': KEY });
    expect(call.init.signal).toBeDefined();
    expect(JSON.parse(call.init.body)).toEqual({
      systemInstruction: { parts: [{ text: PROMPT.system }] },
      contents: [{ role: 'user', parts: [{ text: PROMPT.user }] }],
      generationConfig: { maxOutputTokens: 300, temperature: 0.3 },
    });
    expect(call.init.body).not.toContain(KEY);
  });

  it('joins all text parts and returns an empty string for a malformed body', async () => {
    const parts = { candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }, { other: 1 }] } }] };
    expect(await setup(() => Promise.resolve(jsonResponse(200, parts))).client.complete(PROMPT)).toBe('ab');
    expect(await setup(() => Promise.resolve(jsonResponse(200, { nope: true }))).client.complete(PROMPT)).toBe('');
  });
});

describe('gemini.native: error mapping (Requirement 16.14)', () => {
  it('maps 429 to quota', async () => {
    const body = { error: { status: 'RESOURCE_EXHAUSTED', message: `bad key ${KEY}` } };
    const { client } = setup(() => Promise.resolve(jsonResponse(429, body)));
    expect((await rejection(client.complete(PROMPT))).kind).toBe('quota');
  });

  it('maps 503 to network', async () => {
    const { client } = setup(() => Promise.resolve(jsonResponse(503, { error: { status: 'UNAVAILABLE' } })));
    expect((await rejection(client.complete(PROMPT))).kind).toBe('network');
  });

  it('maps an abort after requestTimeoutMs to timeout and aborts the signal', async () => {
    const { client, calls } = setup(() => new Promise<FetchResponse>(() => undefined), 20);
    const error = await rejection(client.complete(PROMPT));
    expect(error.kind).toBe('timeout');
    const signal = calls[0]?.init.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect((signal as AbortSignal).aborted).toBe(true);
  });

  it('GeminiHttpError carries the status and the API status name or HTTP <status>', () => {
    const error = new GeminiHttpError(503, 'HTTP 503');
    expect(error.status).toBe(503);
    expect(error.name).toBe('GeminiHttpError');
  });
});

describe('gemini.native: no process.env read (Requirement 16.17)', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('ignores GEMINI_API_KEY in process.env and never calls fetch without an env option', async () => {
    const reads: string[] = [];
    process.env = new Proxy(
      { ...originalEnv, GEMINI_API_KEY: KEY, GEMINI_MODEL: 'env-model' },
      {
        get(target, prop, receiver): unknown {
          if (typeof prop === 'string' && prop.startsWith('GEMINI')) reads.push(prop);
          return Reflect.get(target, prop, receiver) as unknown;
        },
      },
    );
    const { fetch, calls } = fakeFetch(() => Promise.resolve(jsonResponse(200, okBody('x'))));
    const client = createGeminiClient({ fetch });

    const error = await rejection(client.complete(PROMPT));
    expect(error.kind).toBe('unknown');
    expect(calls).toHaveLength(0);
    expect(reads).toEqual([]);
  });
});

describe('gemini.native: key never leaks (Requirements 16.1, 16.17)', () => {
  const failures: ReadonlyArray<readonly [string, () => Promise<FetchResponse>]> = [
    ['429', () => Promise.resolve(jsonResponse(429, { error: { status: KEY, message: KEY } }))],
    ['503', () => Promise.resolve(jsonResponse(503, { error: { message: `key=${KEY}` } }))],
    ['thrown fetch error', () => Promise.reject(new TypeError(`failed for ${KEY}`))],
    ['bad json', () => Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error(KEY)) })],
  ];

  it.each(failures)('%s: key absent from URL, error message and log lines', async (_label, respond) => {
    const { client, calls, logs } = setup(respond);
    const error = await rejection(client.complete(PROMPT));
    expect(error.message).not.toContain(KEY);
    expect(calls.every((call) => !call.url.includes(KEY))).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((line) => !line.includes(KEY))).toBe(true);
  });

  it('timeout: key absent from the error message and log lines', async () => {
    const { client, logs } = setup(() => new Promise<FetchResponse>(() => undefined), 10);
    const error = await rejection(client.complete(PROMPT));
    expect(error.message).not.toContain(KEY);
    expect(logs.every((line) => !line.includes(KEY))).toBe(true);
  });
});
