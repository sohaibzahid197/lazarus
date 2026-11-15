// Feature: crypt-ouija-simulator, Property 25: The limiter records exactly the requests that reach it
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../protocol/emptySnapshot';
import { MAX_REQUEST_BYTES } from '../protocol/limits';
import { invalidRequestArb, messageBodyArb } from '../test/arbitraries/request';
import { serverTimeArb, snapshotArb, snapshotViolationArb } from '../test/arbitraries/snapshot';
import { DEFAULT_IP, makeHandler } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { REAL_BRAIN } from './brainFns';
import type { OuijaHandler } from './handler';
import { IP_LIMIT, IP_WINDOW_MS } from './ipLimiter';

/** A Message_Body that makes the injected pipeline throw, for the 500 case. */
const BOOM = 'BOOM internal fault';

/** One request of the sequence: what it is and the raw parts to send. */
type Kind =
  | { readonly kind: 'wrong-method'; readonly method: string }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'invalid-json'; readonly raw: string }
  | { readonly kind: 'invalid-snapshot'; readonly raw: string }
  | { readonly kind: 'valid'; readonly raw: string }
  | { readonly kind: 'internal'; readonly raw: string };

interface Step {
  readonly gap: number;
  readonly req: Kind;
}

interface Case {
  readonly start: number;
  readonly steps: readonly Step[];
}

/** Gaps that keep many requests inside one window, with some that clear it. */
const gapArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 4, arbitrary: fc.constant(0) },
  { weight: 24, arbitrary: fc.integer({ min: 1, max: 5_000 }) },
  { weight: 1, arbitrary: fc.oneof(fc.integer({ min: IP_WINDOW_MS - 1, max: IP_WINDOW_MS + 1 }), fc.integer({ min: IP_WINDOW_MS, max: 3 * IP_WINDOW_MS })) },
);

function kindArb(start: number): fc.Arbitrary<Kind> {
  const good = fc.oneof(fc.constant(emptySnapshot(start)), snapshotArb(start));
  return fc.oneof(
    fc.constantFrom('GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS').map((method): Kind => ({ kind: 'wrong-method', method })),
    fc.constant<Kind>({ kind: 'too-large' }),
    invalidRequestArb.map((r): Kind => ({ kind: 'invalid-json', raw: r.raw })),
    snapshotViolationArb(start).map(
      (v): Kind => ({ kind: 'invalid-snapshot', raw: JSON.stringify({ type: 'message', body: 'HELP', snapshot: v.snapshot }) }),
    ),
    fc
      .tuple(messageBodyArb, good)
      .map(([body, snapshot]): Kind => ({ kind: 'valid', raw: JSON.stringify({ type: 'message', body, snapshot }) })),
    good.map((snapshot): Kind => ({ kind: 'internal', raw: JSON.stringify({ type: 'message', body: BOOM, snapshot }) })),
  );
}

const caseArb: fc.Arbitrary<Case> = serverTimeArb.chain((start) =>
  fc
    .array(fc.record({ gap: gapArb, req: kindArb(start) }), { minLength: 0, maxLength: 120, size: 'max' })
    .map((steps): Case => ({ start, steps })),
);

/** Sends straight to `handler.POST`, so the handler's own method and size checks run. */
async function send(handler: OuijaHandler, req: Kind): Promise<number> {
  const method = req.kind === 'wrong-method' ? req.method : 'POST';
  const raw =
    req.kind === 'wrong-method'
      ? ''
      : req.kind === 'too-large'
        ? JSON.stringify({ type: 'message', body: 'HELP', snapshot: null }) + ' '.repeat(MAX_REQUEST_BYTES + 1)
        : req.raw;
  const headers = new Headers({ 'content-type': 'application/json', 'x-forwarded-for': DEFAULT_IP });
  const hasBody = method !== 'GET';
  const request = new Request('http://localhost/api/ouija', { method, headers, ...(hasBody ? { body: raw } : {}) });
  const res = await handler.POST(request);
  await res.text();
  return res.status;
}

/** Times still inside the window ending at `now`. */
function inWindow(times: readonly number[], now: number): number[] {
  return times.filter((t) => t > now - IP_WINDOW_MS);
}

describe('Ip_Rate_Limiter recording in the Simulator_Route', () => {
  /**
   * **Validates: Requirements 10.2**
   */
  it('Feature: crypt-ouija-simulator, Property 25: The limiter records exactly the requests that reach it', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        let now = c.start;
        const h = makeHandler({
          now: () => now,
          brain: {
            runGatewayPipeline: (msg, ...rest) => {
              if (msg.body === BOOM) throw new Error('injected fault');
              return REAL_BRAIN.runGatewayPipeline(msg, ...rest);
            },
          },
        });
        // Reference: times of the requests that passed method and size and were accepted.
        const accepted: number[] = [];

        for (const step of c.steps) {
          now += step.gap;
          const status = await send(h.handler, step.req);

          if (step.req.kind === 'wrong-method') {
            expect(status).toBe(405);
          } else if (step.req.kind === 'too-large') {
            expect(status).toBe(413);
          } else if (inWindow(accepted, now).length >= IP_LIMIT) {
            expect(status).toBe(429);
          } else {
            accepted.push(now);
            expect(status).not.toBe(429);
            if (step.req.kind === 'internal') expect(status).toBe(500);
            if (step.req.kind === 'invalid-json') expect(status).toBe(400);
          }

          const stored = h.limiter.get().get(DEFAULT_IP) ?? [];
          expect(inWindow(stored, now)).toEqual(inWindow(accepted, now));
        }
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
