// Feature: crypt-ouija-simulator, Property 39: One request at a time, messages first
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { browserNowArb, sessionStateArb } from '../test/arbitraries/session';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { nextRequest } from './outbox';
import { dueReminders } from './reminderPump';
import type { SessionState } from './session.types';

/**
 * A clock time near the state's Reminder Due_Times or retry and recheck times,
 * so that some Reminders are due and some are not, or any browser time.
 */
function clockNear(state: SessionState): fc.Arbitrary<number> {
  const anchors = [
    ...state.snapshot.reminders.map((r) => r.dueAt),
    ...state.retryAt.values(),
    ...state.recheckAt.values(),
  ];
  if (anchors.length === 0) return browserNowArb;
  const near = fc
    .tuple(fc.constantFrom(...anchors), fc.integer({ min: -2_000, max: 2_000 }))
    .map(([t, d]) => Math.max(0, t + d));
  return fc.oneof(near, browserNowArb);
}

/** A SessionState with a corrected clock and a browser clock. */
const outboxCaseArb: fc.Arbitrary<{
  readonly state: SessionState;
  readonly correctedNow: number;
  readonly browserNow: number;
}> = sessionStateArb.chain((state) =>
  fc.record({ state: fc.constant(state), correctedNow: clockNear(state), browserNow: clockNear(state) }),
);

describe('Outbox', () => {
  /**
   * **Validates: Requirements 13.3, 13.9**
   */
  it('Feature: crypt-ouija-simulator, Property 39: One request at a time, messages first', () => {
    fc.assert(
      fc.property(outboxCaseArb, ({ state, correctedNow, browserNow }) => {
        const next = nextRequest(state, correctedNow, browserNow);

        // At most 1 request in flight (13.3).
        if (state.inFlight !== null) {
          expect(next).toBeNull();
          return;
        }

        // A waiting message goes first; due Reminders are held back (13.9).
        if (state.waitingMessage !== null) {
          expect(next).toEqual({ type: 'message', body: state.waitingMessage.body });
          return;
        }

        // Otherwise the first due Reminder by (Due_Time, Reminder_Id), or nothing (13.3).
        const first = dueReminders(state, correctedNow, browserNow)[0];
        expect(next).toEqual(first === undefined ? null : { type: 'deliver', reminderId: first });
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
