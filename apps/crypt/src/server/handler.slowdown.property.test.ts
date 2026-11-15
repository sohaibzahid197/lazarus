// Feature: crypt-ouija-simulator, Property 24: Per-IP Slow_Down_Text speaks the message Language
import { detectLanguage, GATEWAY_TEXTS } from '@lazarus/brain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import { messageBodyArb } from '../test/arbitraries/request';
import { serverTimeArb, snapshotArb } from '../test/arbitraries/snapshot';
import { DEFAULT_IP, makeHandler, post } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { IP_LIMIT, IP_WINDOW_MS } from './ipLimiter';
import { sanitizeText } from './sanitize';

interface Case {
  readonly serverTime: number;
  readonly body: string;
  readonly snapshot: SessionSnapshot;
  /** 30 ascending recorded times inside the window ending at `serverTime`. */
  readonly fullWindow: readonly number[];
}

const caseArb: fc.Arbitrary<Case> = serverTimeArb.chain((serverTime) =>
  fc.record({
    serverTime: fc.constant(serverTime),
    body: messageBodyArb,
    snapshot: snapshotArb(serverTime),
    fullWindow: fc
      .array(fc.integer({ min: Math.max(0, serverTime - IP_WINDOW_MS + 1), max: serverTime }), {
        minLength: IP_LIMIT,
        maxLength: IP_LIMIT,
      })
      .map((ts) => [...ts].sort((a, b) => a - b)),
  }),
);

describe('Simulator_Route per-IP Slow_Down_Text', () => {
  /**
   * **Validates: Requirements 10.3, 10.4**
   */
  it('Feature: crypt-ouija-simulator, Property 24: Per-IP Slow_Down_Text speaks the message Language', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const h = makeHandler({ now: c.serverTime });
        h.limiter.set(new Map([[DEFAULT_IP, c.fullWindow]]));

        const res = await post(h.handler, { type: 'message', body: c.body, snapshot: c.snapshot });

        expect(res.status).toBe(429);
        const want = sanitizeText(GATEWAY_TEXTS[detectLanguage(c.body)].slowDown, h.ai.secrets);
        // Only the error code and the Slow_Down_Text: no snapshot, Replies_Left or parts (7.13).
        expect(res.json).toStrictEqual({ error: 'rate-limited', slowDown: want });

        const retryAfter = res.headers.get('retry-after');
        expect(retryAfter).toMatch(/^\d+$/);
        const seconds = Number(retryAfter);
        expect(seconds).toBeGreaterThanOrEqual(1);
        expect(seconds).toBeLessThanOrEqual(600);
        const oldest = c.fullWindow[0] ?? c.serverTime;
        expect(seconds).toBe(Math.min(600, Math.max(1, Math.ceil((oldest + IP_WINDOW_MS - c.serverTime) / 1_000))));

        // A rejected request is not recorded and reaches neither the brain nor Gemini (10.2, 10.3).
        expect(h.limiter.get().get(DEFAULT_IP)).toStrictEqual(c.fullWindow);
        expect(h.client?.calls.length ?? 0).toBe(0);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
