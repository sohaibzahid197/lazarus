import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../protocol/emptySnapshot';
import type { SimulatorRequest, SimulatorResponse } from '../protocol/wire.types';
import { OUIJA_URL, REQUEST_TIMEOUT_MS, postOuija, type ApiEnv } from './api';

const NOW = 1_767_225_600_000;

const MESSAGE: SimulatorRequest = { type: 'message', body: 'HELP', snapshot: emptySnapshot(NOW) };
const DELIVER: SimulatorRequest = {
  type: 'deliver',
  reminderId: 'r:mabc-a',
  snapshot: emptySnapshot(NOW),
};

function validResponse(): SimulatorResponse {
  return {
    kind: 'message',
    parts: [{ text: 'Lazarus: text any question.', units: 27, limit: 160 }],
    encoding: 'GSM-7',
    command: 'HELP',
    language: 'en',
    outcome: 'replied',
    deliveryOutcome: null,
    snapshot: emptySnapshot(NOW),
    repliesLeft: 4,
    serverTime: NOW,
  };
}

interface Timer {
  readonly fn: () => void;
  readonly ms: number;
  cleared: boolean;
}

interface FakeEnv {
  readonly env: ApiEnv;
  readonly timers: Timer[];
  readonly calls: { url: string; init: RequestInit | undefined }[];
  /** Fires every pending, uncleared timer whose delay is at most `ms`. */
  advance(ms: number): void;
}

type Responder = (init: RequestInit | undefined) => Promise<Response>;

function fakeEnv(respond: Responder): FakeEnv {
  const timers: Timer[] = [];
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return respond(init);
  };
  const env: ApiEnv = {
    fetch: fetchFn,
    setTimeout: (fn, ms) => {
      const t: Timer = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (handle) => {
      const t = timers.find((x) => x === handle);
      if (t) t.cleared = true;
    },
  };
  return {
    env,
    timers,
    calls,
    advance(ms) {
      for (const t of timers) {
        if (!t.cleared && t.ms <= ms) {
          t.cleared = true;
          t.fn();
        }
      }
    },
  };
}

function reply(status: number, body: unknown): Responder {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

/** A fetch that never answers and rejects when its signal aborts, like the browser fetch. */
const hang: Responder = (init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'));
    });
  });

describe('postOuija', () => {
  it('posts JSON to /api/ouija with credentials omitted and maps a valid 200 to ok', async () => {
    const f = fakeEnv(reply(200, validResponse()));
    const result = await postOuija(MESSAGE, new AbortController().signal, f.env);
    expect(result).toEqual({ kind: 'ok', response: validResponse() });
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0];
    expect(call?.url).toBe(OUIJA_URL);
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.credentials).toBe('omit');
    expect(call?.init?.body).toBe(JSON.stringify(MESSAGE));
  });

  it('maps no response within 30 seconds to failed', async () => {
    const f = fakeEnv(hang);
    const pending = postOuija(MESSAGE, new AbortController().signal, f.env);
    expect(f.timers.map((t) => t.ms)).toEqual([REQUEST_TIMEOUT_MS]);
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
    f.advance(REQUEST_TIMEOUT_MS - 1);
    expect(f.timers[0]?.cleared).toBe(false);
    f.advance(REQUEST_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ kind: 'failed' });
  });

  it('clears the timeout timer after a response', async () => {
    const f = fakeEnv(reply(200, validResponse()));
    const result = await postOuija(MESSAGE, new AbortController().signal, f.env);
    expect(result.kind).toBe('ok');
    expect(f.timers.every((t) => t.cleared)).toBe(true);
  });

  it('maps a network failure to failed', async () => {
    const f = fakeEnv(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(postOuija(MESSAGE, new AbortController().signal, f.env)).resolves.toEqual({
      kind: 'failed',
    });
  });

  it('maps 429 to rate-limited with the slowDown text, or null without one', async () => {
    const withText = fakeEnv(reply(429, { error: 'rate-limited', slowDown: 'Please slow down.' }));
    await expect(postOuija(MESSAGE, new AbortController().signal, withText.env)).resolves.toEqual({
      kind: 'rate-limited',
      slowDown: 'Please slow down.',
    });
    const without = fakeEnv(reply(429, { error: 'rate-limited' }));
    await expect(postOuija(DELIVER, new AbortController().signal, without.env)).resolves.toEqual({
      kind: 'rate-limited',
      slowDown: null,
    });
  });

  it('maps 400 invalid-snapshot to invalid-snapshot and other 400s on message to failed', async () => {
    const bad = fakeEnv(reply(400, { error: 'invalid-snapshot' }));
    await expect(postOuija(MESSAGE, new AbortController().signal, bad.env)).resolves.toEqual({
      kind: 'invalid-snapshot',
    });
    const body = fakeEnv(reply(400, { error: 'invalid-body' }));
    await expect(postOuija(MESSAGE, new AbortController().signal, body.env)).resolves.toEqual({
      kind: 'failed',
    });
  });

  it('maps any 400 on deliver to invalid-snapshot', async () => {
    for (const error of ['invalid-reminder-id', 'invalid-json', 'invalid-snapshot']) {
      const f = fakeEnv(reply(400, { error }));
      await expect(postOuija(DELIVER, new AbortController().signal, f.env)).resolves.toEqual({
        kind: 'invalid-snapshot',
      });
    }
  });

  it('maps a 200 with an invalid body, and other statuses, to failed', async () => {
    const cases: [number, unknown][] = [
      [200, { ...validResponse(), repliesLeft: 6 }],
      [200, 'not a response'],
      [500, { error: 'internal' }],
      [413, { error: 'body-too-large' }],
    ];
    for (const [status, body] of cases) {
      const f = fakeEnv(reply(status, body));
      await expect(postOuija(MESSAGE, new AbortController().signal, f.env)).resolves.toEqual({
        kind: 'failed',
      });
    }
    const notJson = fakeEnv(() => Promise.resolve(new Response('<html>', { status: 200 })));
    await expect(postOuija(MESSAGE, new AbortController().signal, notJson.env)).resolves.toEqual({
      kind: 'failed',
    });
  });

  it('maps an abort by the caller (Session_Reset) to aborted', async () => {
    const f = fakeEnv(hang);
    const outer = new AbortController();
    const pending = postOuija(MESSAGE, outer.signal, f.env);
    outer.abort();
    await expect(pending).resolves.toEqual({ kind: 'aborted' });
    expect(f.timers.every((t) => t.cleared)).toBe(true);
  });

  it('returns aborted without fetching when the signal is already aborted', async () => {
    const f = fakeEnv(reply(200, validResponse()));
    const outer = new AbortController();
    outer.abort();
    await expect(postOuija(MESSAGE, outer.signal, f.env)).resolves.toEqual({ kind: 'aborted' });
    expect(f.calls).toHaveLength(0);
  });
});
