// Feature: crypt-ouija-simulator, Property 38: Due Reminders are picked in order and timers stay in range
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SnapshotReminder } from '../protocol/snapshot.types';
import { browserNowArb, clockOffsetArb, sessionStateArb } from '../test/arbitraries/session';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { MAX_TIMER_DELAY_MS, dueReminders, nextWakeDelay } from './reminderPump';
import type { SessionState } from './session.types';

/** Small shifts that land just before, on or just after a boundary. */
const nudgeArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.integer({ min: -2, max: 2 }),
  fc.integer({ min: -120_000, max: 120_000 }),
);

/** A browser time: anywhere, or near a Due_Time, retry or recheck time of the state. */
function browserNowNear(state: SessionState, clockOffset: number): fc.Arbitrary<number> {
  const anchors = [
    ...state.snapshot.reminders.map((r) => r.dueAt - clockOffset),
    ...state.retryAt.values(),
    ...state.recheckAt.values(),
  ];
  if (anchors.length === 0) return browserNowArb;
  return fc.oneof(
    browserNowArb,
    fc.tuple(fc.constantFrom(...anchors), nudgeArb).map(([a, d]) => a + d),
  );
}

/** A state with its own clock offset, and both clocks for one pump run. */
const pumpInputArb = fc
  .record({ state: sessionStateArb, clockOffset: clockOffsetArb })
  .chain(({ state, clockOffset }) => {
    const s: SessionState = { ...state, clockOffset };
    return browserNowNear(s, clockOffset).map((browserNow) => ({
      state: s,
      browserNow,
      correctedNow: browserNow + clockOffset,
    }));
  });

/** Reference rule of 13.2, 13.3, 13.8 and C8, written independently of the pump. */
function isDue(s: SessionState, r: SnapshotReminder, correctedNow: number, browserNow: number): boolean {
  const retry = s.retryAt.get(r.id);
  const recheck = s.recheckAt.get(r.id);
  return (
    r.dueAt <= correctedNow &&
    (retry === undefined || retry <= browserNow) &&
    (recheck === undefined || recheck <= browserNow)
  );
}

function compareDueThenId(a: SnapshotReminder, b: SnapshotReminder): number {
  if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

describe('Reminder pump', () => {
  /**
   * **Validates: Requirements 13.2, 13.3**
   */
  it('Feature: crypt-ouija-simulator, Property 38: Due Reminders are picked in order and timers stay in range', () => {
    fc.assert(
      fc.property(pumpInputArb, ({ state, browserNow, correctedNow }) => {
        const expected = state.snapshot.reminders
          .filter((r) => isDue(state, r, correctedNow, browserNow))
          .slice()
          .sort(compareDueThenId)
          .map((r) => r.id);
        expect(dueReminders(state, correctedNow, browserNow)).toEqual(expected);

        const delay = nextWakeDelay(state, correctedNow, browserNow);
        if (delay !== null) {
          expect(Number.isInteger(delay)).toBe(true);
          expect(delay).toBeGreaterThanOrEqual(0);
          expect(delay).toBeLessThanOrEqual(MAX_TIMER_DELAY_MS);
        }
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
