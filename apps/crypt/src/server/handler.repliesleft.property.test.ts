// Feature: crypt-ouija-simulator, Property 29: Replies_Left equals the brain formula
import fc from 'fast-check';
import { DEFAULT_SETTINGS, checkRate, countInWindow, countersFor, localDayKey } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorResponse } from '../protocol/wire.types';
import { aiReplyArb, messageBodyArb } from '../test/arbitraries/request';
import { snapshotAtArb } from '../test/arbitraries/snapshot';
import { makeHandler, post } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';

/** Pakistan_Time offset in minutes and milliseconds per minute (Glossary). */
const PK_OFFSET = 300;
const MINUTE_MS = 60_000;

/** The Glossary formula, computed directly with the brain exports on the returned snapshot. */
function glossaryRepliesLeft(snapshot: SessionSnapshot, serverTime: number): number {
  const s = DEFAULT_SETTINGS;
  const today = localDayKey(serverTime, PK_OFFSET);
  if (countersFor(snapshot.counters, today).handed >= s.dailySendCap) return 0;
  const used = countInWindow(snapshot.receiveTimes, serverTime, s.rateWindowMinutes * MINUTE_MS);
  return Math.max(0, s.perNumberLimit - used);
}

/** The "exactly 0 when" condition of 19.13, via `checkRate` instead of `countInWindow`. */
function blocked(snapshot: SessionSnapshot, serverTime: number): boolean {
  const s = DEFAULT_SETTINGS;
  const rate = checkRate(snapshot.receiveTimes, serverTime, s.perNumberLimit, s.rateWindowMinutes * MINUTE_MS);
  const handed = countersFor(snapshot.counters, localDayKey(serverTime, PK_OFFSET)).handed;
  return !rate.accepted || handed >= s.dailySendCap;
}

describe('Replies_Left equals the brain formula', () => {
  /**
   * **Validates: Requirements 19.6, 19.13**
   */
  it('Feature: crypt-ouija-simulator, Property 29: Replies_Left equals the brain formula', async () => {
    await fc.assert(
      fc.asyncProperty(
        snapshotAtArb,
        messageBodyArb,
        aiReplyArb,
        fc.boolean(),
        async ({ serverTime, snapshot }, body, aiReply, withKey) => {
          const h = makeHandler({ now: serverTime, aiReply, withKey });
          const res = await post(h.handler, { type: 'message', body, snapshot });
          expect(res.status).toBe(200);

          const got = res.json as SimulatorResponse;
          expect(got.serverTime).toBe(serverTime);
          expect(Number.isInteger(got.repliesLeft)).toBe(true);
          expect(got.repliesLeft).toBeGreaterThanOrEqual(0);
          expect(got.repliesLeft).toBeLessThanOrEqual(DEFAULT_SETTINGS.perNumberLimit);
          expect(got.repliesLeft).toBe(glossaryRepliesLeft(got.snapshot, serverTime));
          expect(got.repliesLeft === 0).toBe(blocked(got.snapshot, serverTime));
        },
      ),
      CRYPT_PBT_OPTIONS,
    );
  });
});
