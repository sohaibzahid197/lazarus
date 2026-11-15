// Feature: crypt-ouija-simulator, Property 30: New session restores a clean server view
import fc from 'fast-check';
import { checkRate, DEFAULT_SETTINGS, localDayKey, pruneRate, routeCommand, zeroCounters } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../protocol/emptySnapshot';
import { isSimulatorResponse } from '../protocol/response.check';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import { aiReplyArb, messageBodyArb } from '../test/arbitraries/request';
import { snapshotAtArb } from '../test/arbitraries/snapshot';
import { makeHandler, post } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * Chained requests re-parse each printed snapshot. 20 messages add at most 80 to any day count,
 * so starting counts at or below 1,000,000 − 100 keep every printed count within the 8.4 cap
 * (same boundary as Property 15).
 */
const START_COUNT_MAX = 999_900;

/**
 * Keeps only the receive times a real session can hold (8.7): replays them in order through the
 * brain's own Rate_Limiter rule and keeps the accepted ones, then prunes as the brain does after
 * the last record. Such a session has at most 5 times in any 60-minute window, so at most 120 in
 * the 24-hour retention. The shared snapshotArb may hold 120 bunched times, which no session
 * reaches; one more accepted message would print 121 and the next request would get a 400.
 */
function reachableTimes(times: readonly number[]): readonly number[] {
  const windowMs = DEFAULT_SETTINGS.rateWindowMinutes * MINUTE_MS;
  const kept: number[] = [];
  for (const t of times) {
    if (checkRate(kept, t, DEFAULT_SETTINGS.perNumberLimit, windowMs).accepted) kept.push(t);
  }
  const last = kept[kept.length - 1];
  return last === undefined ? kept : pruneRate(kept, last);
}

const startArb = snapshotAtArb.map(({ serverTime, snapshot }) => {
  const c = snapshot.counters;
  const cap = (n: number): number => Math.min(n, START_COUNT_MAX);
  const counters = {
    dayKey: c.dayKey,
    received: cap(c.received),
    repliesSent: cap(c.repliesSent),
    replied: cap(c.replied),
    partsSent: cap(c.partsSent),
    ignored: cap(c.ignored),
    handed: cap(c.handed),
  };
  return { serverTime, snapshot: { ...snapshot, receiveTimes: reachableTimes(snapshot.receiveTimes), counters } };
});

/** Time between two requests: equal times, seconds, about a minute, hours. */
const gapArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 0, max: 5_000 }),
  fc.integer({ min: MINUTE_MS - 1_000, max: 3 * MINUTE_MS }),
  fc.integer({ min: 0, max: 3 * HOUR_MS }),
);

const stepArb = fc.record({ body: messageBodyArb, gap: gapArb });

/** A Message_Body that the Command_Router routes to a Command other than STOP. */
const nonStopBodyArb: fc.Arbitrary<string> = messageBodyArb.filter((b) => routeCommand(b).command !== 'STOP');

const BLOCKED_OUTCOMES: readonly string[] = ['rate-limited', 'send-capped', 'ignored-stopped'];

describe('New session restores a clean server view', () => {
  /**
   * **Validates: Requirements 8.5, 19.14**
   */
  it('Feature: crypt-ouija-simulator, Property 30: New session restores a clean server view', async () => {
    await fc.assert(
      fc.asyncProperty(
        startArb,
        aiReplyArb,
        fc.array(stepArb, { minLength: 0, maxLength: 20 }),
        gapArb,
        nonStopBodyArb,
        async ({ serverTime: start, snapshot: first }, aiReply, steps, resetGap, nextBody) => {
          let now = start;
          const harness = makeHandler({ now: () => now, aiReply });
          let snapshot: SessionSnapshot = first;

          for (const step of steps) {
            now += step.gap;
            const res = await post(harness.handler, { type: 'message', body: step.body, snapshot });
            expect(res.status).toBe(200);
            if (!isSimulatorResponse(res.json)) throw new Error(`not a Simulator_Response: ${res.text}`);
            snapshot = res.json.snapshot;
          }

          // Session_Reset: the browser drops the old snapshot for the empty one of 8.5.
          now += resetGap;
          const reset = emptySnapshot(now);
          expect(reset).toEqual({
            stopped: false,
            receiveTimes: [],
            slowDownAt: null,
            counters: zeroCounters(localDayKey(now, 300)),
            reminders: [],
          });

          const res = await post(harness.handler, { type: 'message', body: nextBody, snapshot: reset });
          expect(res.status).toBe(200);
          if (!isSimulatorResponse(res.json)) throw new Error(`not a Simulator_Response: ${res.text}`);
          const outcome = res.json.outcome;
          if (outcome === null) throw new Error('message response without an Outcome');
          expect(BLOCKED_OUTCOMES).not.toContain(outcome);
          expect(res.json.repliesLeft).toBe(DEFAULT_SETTINGS.perNumberLimit - 1);
        },
      ),
      CRYPT_PBT_OPTIONS,
    );
  });
});
