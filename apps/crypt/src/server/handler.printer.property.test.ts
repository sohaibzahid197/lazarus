// Feature: crypt-ouija-simulator, Property 15: Printed snapshots are always accepted and number-free
import fc from 'fast-check';
import { checkRate, DEFAULT_SETTINGS, pruneRate, REMINDER_LIMIT } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import { isSimulatorResponse } from '../protocol/response.check';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import { aiReplyArb, messageBodyArb, SIMULATOR_DIGITS } from '../test/arbitraries/request';
import { snapshotAtArb } from '../test/arbitraries/snapshot';
import { makeHandler, post } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { parseSnapshot } from './snapshot.parse';
import { SIMULATOR_NUMBER } from './simulatorNumber';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** A Reminder_Id no generated or brain-made snapshot holds, for the not-found deliver case. */
const MISSING_ID = 'r:not-in-snapshot';

/**
 * Requirement 8.7 covers states the Gateway_Pipeline can reach. One request adds at most 1 to
 * `received`, `repliesSent`, `replied` or `ignored` and at most 4 (one reply's parts) to `partsSent`
 * or `handed`, so 20 steps add at most 80 to any count. Starting every count at or below
 * 1,000,000 − 100 keeps all printed counts under the 8.4 cap of 1,000,000, which a real day
 * under the per-IP limit never comes close to.
 */
const START_COUNT_MAX = 999_900;

/**
 * Keeps only the receive times a real session can hold (8.7): replays them in order through the
 * brain's own Rate_Limiter rule and keeps the accepted ones, then prunes as the brain does after
 * the last record. A session built from emptySnapshot this way never has more than 5 times in any
 * 60-minute window, so at most 24 × 5 = 120 within the 24-hour retention. The shared snapshotArb
 * may hold 120 times bunched together, which no session reaches; one more accepted message would
 * then print 121 times.
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

type Step =
  | { readonly kind: 'message'; readonly body: string; readonly gap: number }
  | { readonly kind: 'deliver'; readonly pick: number | null; readonly gap: number };

/** Time between two requests: equal times, seconds, about a Reminder's minute, hours past the Late_Window. */
const gapArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 0, max: 5_000 }),
  fc.integer({ min: MINUTE_MS - 1_000, max: 3 * MINUTE_MS }),
  fc.integer({ min: 0, max: 3 * HOUR_MS }),
);

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('message' as const), body: messageBodyArb, gap: gapArb }) },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant('deliver' as const), pick: fc.option(fc.nat(), { nil: null }), gap: gapArb }),
  },
);

/** The Reminder_Id a deliver step asks for: one in the current snapshot, or one that is absent. */
function reminderIdFor(snapshot: SessionSnapshot, pick: number | null): string {
  if (pick === null || snapshot.reminders.length === 0) return MISSING_ID;
  return snapshot.reminders[pick % snapshot.reminders.length]?.id ?? MISSING_ID;
}

describe('Printed snapshots across sessions', () => {
  /**
   * **Validates: Requirements 8.1, 8.7, 13.1**
   */
  it('Feature: crypt-ouija-simulator, Property 15: Printed snapshots are always accepted and number-free', async () => {
    await fc.assert(
      fc.asyncProperty(
        startArb,
        aiReplyArb,
        fc.array(stepArb, { minLength: 1, maxLength: 20 }),
        async ({ serverTime: start, snapshot: first }, aiReply, steps) => {
          let now = start;
          const harness = makeHandler({ now: () => now, aiReply });
          let snapshot: SessionSnapshot = first;

          for (const step of steps) {
            now += step.gap;
            const request =
              step.kind === 'message'
                ? { type: 'message', body: step.body, snapshot }
                : { type: 'deliver', reminderId: reminderIdFor(snapshot, step.pick), snapshot };
            const res = await post(harness.handler, request);

            expect(res.status).toBe(200);
            if (!isSimulatorResponse(res.json)) throw new Error(`not a Simulator_Response: ${res.text}`);
            expect(res.json.serverTime).toBe(now);

            const next = res.json.snapshot;
            const parsed = parseSnapshot(next, now, SIMULATOR_NUMBER);
            if (!parsed.ok) throw new Error(`parseSnapshot rejected a printed snapshot: ${parsed.error}`);
            expect(next.reminders.length).toBeLessThanOrEqual(REMINDER_LIMIT);

            const serialized = JSON.stringify(next);
            expect(serialized).not.toContain(SIMULATOR_NUMBER);
            expect(serialized).not.toContain(SIMULATOR_DIGITS);

            snapshot = next;
          }
        },
      ),
      CRYPT_PBT_OPTIONS,
    );
  });
});
