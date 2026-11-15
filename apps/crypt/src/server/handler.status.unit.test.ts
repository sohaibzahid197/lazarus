// Status code example tests for the Simulator_Route handler
// (Requirements 7.8, 7.9, 7.10, 18.6).
import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../protocol/emptySnapshot';
import { MAX_BODY_UNITS, MAX_REQUEST_BYTES } from '../protocol/limits';
import { makeHandler, post, type PostResult } from '../test/handlerHarness';
import { IP_LIMIT, IP_WINDOW_MS } from './ipLimiter';

const NOW = Date.UTC(2026, 0, 15, 9, 30, 0);

function helpRequest(): unknown {
  return { type: 'message', body: 'HELP', snapshot: emptySnapshot(NOW) };
}

/** Error responses carry only `{ error }`, `no-store` and no cookie. */
function expectBareError(res: PostResult, status: number, error: string): void {
  expect(res.status).toBe(status);
  expect(res.json).toEqual({ error });
  expect(res.headers.get('content-type')).toBe('application/json');
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('set-cookie')).toBeNull();
}

describe('Simulator_Route status codes', () => {
  it('answers 400 invalid-json to a body that is not JSON', async () => {
    const { handler } = makeHandler({ now: NOW });
    const res = await post(handler, '{not json');
    expectBareError(res, 400, 'invalid-json');
  });

  it('answers 400 invalid-body to a Message_Body of 481 UTF-16 code units', async () => {
    const { handler, client } = makeHandler({ now: NOW });
    const body = 'a'.repeat(MAX_BODY_UNITS + 1);
    const res = await post(handler, { type: 'message', body, snapshot: emptySnapshot(NOW) });
    expectBareError(res, 400, 'invalid-body');
    expect(client?.calls.length ?? 0).toBe(0);
  });

  it('accepts a Message_Body of exactly 480 UTF-16 code units', async () => {
    const { handler } = makeHandler({ now: NOW });
    const res = await post(handler, { type: 'message', body: 'a'.repeat(MAX_BODY_UNITS), snapshot: emptySnapshot(NOW) });
    expect(res.status).toBe(200);
  });

  it('answers 413 to a body of 16,385 bytes without recording it in the limiter', async () => {
    const { handler, limiter } = makeHandler({ now: NOW });
    const res = await post(handler, 'x'.repeat(MAX_REQUEST_BYTES + 1));
    expectBareError(res, 413, 'body-too-large');
    expect(limiter.get().size).toBe(0);
  });

  it('answers 405 to a GET request without recording it in the limiter', async () => {
    const { handler, limiter } = makeHandler({ now: NOW });
    const res = await post(handler, undefined, { method: 'GET' });
    expectBareError(res, 405, 'method-not-allowed');
    expect(limiter.get().size).toBe(0);
  });

  it('answers 429 with Retry-After 1..600 to the 31st request from one Client_Ip in 600,000 ms', async () => {
    let now = NOW;
    const { handler } = makeHandler({ now: () => now });
    const step = Math.floor((IP_WINDOW_MS - 1) / (IP_LIMIT + 1));
    for (let i = 0; i < IP_LIMIT; i += 1) {
      const ok = await post(handler, helpRequest());
      expect(ok.status).not.toBe(429);
      now += step;
    }
    const res = await post(handler, helpRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
    const retryAfter = Number(res.headers.get('retry-after'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(600);
    // Oldest of the 30 is at NOW; it is 600,000 ms old at NOW + 600,000.
    expect(retryAfter).toBe(Math.ceil((NOW + IP_WINDOW_MS - now) / 1000));
    const body = res.json as Record<string, unknown>;
    expect(body.error).toBe('rate-limited');
    expect(Object.keys(body).sort()).toEqual(['error', 'slowDown']);
  });

  it('keeps other Client_Ips unaffected by one Client_Ip hitting the limit', async () => {
    const { handler } = makeHandler({ now: NOW });
    for (let i = 0; i < IP_LIMIT; i += 1) await post(handler, helpRequest(), { ip: '198.51.100.1' });
    expect((await post(handler, helpRequest(), { ip: '198.51.100.1' })).status).toBe(429);
    expect((await post(handler, helpRequest(), { ip: '198.51.100.2' })).status).toBe(200);
  });

  it('answers 500 with only { error: "internal" } when a brain dependency throws', async () => {
    const secretText = 'boom: stack trace with HELP and secrets';
    const { handler, key } = makeHandler({
      now: NOW,
      brain: {
        runGatewayPipeline: () => {
          throw new Error(secretText);
        },
      },
    });
    const res = await post(handler, { type: 'message', body: 'HELP me with this', snapshot: emptySnapshot(NOW) });
    expectBareError(res, 500, 'internal');
    expect(res.text).not.toContain(secretText);
    expect(res.text).not.toContain('HELP me with this');
    expect(res.text).not.toContain(key);
  });

  it('answers 500 when applyChanges throws while handling a message', async () => {
    const { handler } = makeHandler({
      now: NOW,
      brain: {
        applyChanges: () => {
          throw new Error('unexpected');
        },
      },
    });
    const res = await post(handler, helpRequest());
    expectBareError(res, 500, 'internal');
  });

  it('answers 200 with no-store and no Set-Cookie to a valid HELP request', async () => {
    const { handler } = makeHandler({ now: NOW });
    const res = await post(handler, helpRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
