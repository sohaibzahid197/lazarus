// Feature: crypt-ouija-simulator, Property 16: Checks run in the fixed order
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import { MAX_REQUEST_BYTES } from '../protocol/limits';
import { invalidRequestArb, messageBodyArb } from '../test/arbitraries/request';
import { serverTimeArb, snapshotArb, snapshotViolationArb } from '../test/arbitraries/snapshot';
import { DEFAULT_IP, makeHandler } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { REAL_BRAIN, type BrainFns } from './brainFns';
import type { OuijaHandler } from './handler';
import { IP_LIMIT, IP_WINDOW_MS } from './ipLimiter';

/** Which checks the generated request is built to fail. */
interface Failures {
  readonly method: boolean;
  readonly size: boolean;
  readonly limiter: boolean;
  readonly shape: boolean;
  readonly snapshot: boolean;
}

interface Case {
  readonly serverTime: number;
  readonly failures: Failures;
  readonly badMethod: string;
  /** Raw JSON body that fails the shape check, with its expected error code. */
  readonly badShape: { readonly raw: string; readonly error: string };
  /** A snapshot that fails `parseSnapshot` at `serverTime`. */
  readonly badSnapshot: unknown;
  /** A valid snapshot at `serverTime`. */
  readonly goodSnapshot: SessionSnapshot;
  /** The valid request kind and its payload field. */
  readonly valid: { readonly type: 'message'; readonly body: string } | { readonly type: 'deliver'; readonly reminderId: string };
  /** 30 recorded times inside the window, for a Client_Ip at its limit. */
  readonly fullWindow: readonly number[];
}

const failuresArb: fc.Arbitrary<Failures> = fc.record({
  method: fc.boolean(),
  size: fc.boolean(),
  limiter: fc.boolean(),
  shape: fc.boolean(),
  snapshot: fc.boolean(),
});

const caseArb: fc.Arbitrary<Case> = serverTimeArb.chain((serverTime) =>
  fc
    .record({
      failures: failuresArb,
      badMethod: fc.constantFrom('GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'),
      badShape: invalidRequestArb,
      badSnapshot: snapshotViolationArb(serverTime).map((v) => v.snapshot),
      goodSnapshot: snapshotArb(serverTime),
      body: messageBodyArb,
      deliver: fc.boolean(),
      otherId: fc.string({ minLength: 1, maxLength: 64 }),
      fullWindow: fc
        .array(fc.integer({ min: Math.max(0, serverTime - IP_WINDOW_MS + 1), max: serverTime }), {
          minLength: IP_LIMIT,
          maxLength: IP_LIMIT,
        })
        .map((ts) => [...ts].sort((a, b) => a - b)),
    })
    .map(({ failures, badMethod, badShape, badSnapshot, goodSnapshot, body, deliver, otherId, fullWindow }): Case => {
      const firstId = goodSnapshot.reminders[0]?.id;
      const valid = deliver
        ? { type: 'deliver' as const, reminderId: firstId ?? otherId }
        : { type: 'message' as const, body };
      return { serverTime, failures, badMethod, badShape, badSnapshot, goodSnapshot, valid, fullWindow };
    }),
);

/** The raw body of the generated request, before any size padding. */
function rawBody(c: Case): string {
  if (c.failures.shape) return c.badShape.raw;
  const snapshot = c.failures.snapshot ? c.badSnapshot : c.goodSnapshot;
  return JSON.stringify({ ...c.valid, snapshot });
}

/** Status and error code of the first failing check, in the order 405, 413, 429, 400, 400 (7.12). */
function expected(c: Case): { readonly status: number; readonly error: string | null } {
  const f = c.failures;
  if (f.method) return { status: 405, error: 'method-not-allowed' };
  if (f.size) return { status: 413, error: 'body-too-large' };
  if (f.limiter) return { status: 429, error: 'rate-limited' };
  if (f.shape) return { status: 400, error: c.badShape.error };
  if (f.snapshot) return { status: 400, error: 'invalid-snapshot' };
  return { status: 200, error: null };
}

/** Brain functions that count their calls and otherwise behave as the real brain. */
function countingBrain(): { readonly brain: BrainFns; readonly calls: () => number } {
  let calls = 0;
  const brain: BrainFns = {
    runGatewayPipeline: (...args) => {
      calls += 1;
      return REAL_BRAIN.runGatewayPipeline(...args);
    },
    applyChanges: (...args) => {
      calls += 1;
      return REAL_BRAIN.applyChanges(...args);
    },
    finalizeSend: (...args) => {
      calls += 1;
      return REAL_BRAIN.finalizeSend(...args);
    },
    decideDelivery: (...args) => {
      calls += 1;
      return REAL_BRAIN.decideDelivery(...args);
    },
    finalizeDelivery: (...args) => {
      calls += 1;
      return REAL_BRAIN.finalizeDelivery(...args);
    },
  };
  return { brain, calls: () => calls };
}

/** Sends the request straight to `handler.POST`, so the handler's own method check runs. */
async function send(handler: OuijaHandler, c: Case): Promise<{ status: number; json: unknown }> {
  const method = c.failures.method ? c.badMethod : 'POST';
  let raw = rawBody(c);
  // Trailing whitespace keeps the JSON valid, so only the size check can fail on it.
  if (c.failures.size) raw += ' '.repeat(MAX_REQUEST_BYTES + 1);
  const headers = new Headers({ 'content-type': 'application/json', 'x-forwarded-for': DEFAULT_IP });
  const hasBody = method !== 'GET';
  const req = new Request('http://localhost/api/ouija', { method, headers, ...(hasBody ? { body: raw } : {}) });
  const res = await handler.POST(req);
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text) as unknown };
}

describe('Simulator_Route check order', () => {
  /**
   * **Validates: Requirements 7.12, 10.1**
   */
  it('Feature: crypt-ouija-simulator, Property 16: Checks run in the fixed order', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const counter = countingBrain();
        const h = makeHandler({ now: c.serverTime, brain: counter.brain });
        if (c.failures.limiter) h.limiter.set(new Map([[DEFAULT_IP, c.fullWindow]]));

        const res = await send(h.handler, c);
        const want = expected(c);

        expect(res.status).toBe(want.status);
        if (want.error === null) {
          // Every check passed: the brain ran (a message always reaches the pipeline).
          if (c.valid.type === 'message') expect(counter.calls()).toBeGreaterThan(0);
        } else {
          expect(res.json).toMatchObject({ error: want.error });
          expect(counter.calls()).toBe(0);
          expect(h.client?.calls.length ?? 0).toBe(0);
        }
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
