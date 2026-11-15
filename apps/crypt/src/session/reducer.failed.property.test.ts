// Feature: crypt-ouija-simulator, Property 33: Failed and limited requests keep the session view
import fc from 'fast-check';
import { GATEWAY_TEXTS } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import { epochActionArb, sessionStateArb, type EpochAction } from '../test/arbitraries/session';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { CONNECTION_ERROR_TEXT } from '../ui/texts';
import { sessionReducer } from './session.reducer';
import type { SessionState } from './session.types';

type FailAction = Extract<EpochAction, { readonly type: 'rate-limited' | 'failed' }>;

function isFailAction(a: EpochAction): a is FailAction {
  return a.type === 'rate-limited' || a.type === 'failed';
}

/** A SessionState with a `rate-limited` or `failed` action carrying the state's own epoch. */
const failCaseArb: fc.Arbitrary<{ readonly state: SessionState; readonly action: FailAction }> = sessionStateArb.chain(
  (state) =>
    epochActionArb(fc.constant(state.epoch), state.snapshot)
      .filter(isFailAction)
      .map((action) => ({ state, action })),
);

/** The urgent note text a `message` failure must add. */
function expectedNoteText(action: FailAction): string {
  if (action.type === 'failed') return CONNECTION_ERROR_TEXT;
  return action.slowDown ?? GATEWAY_TEXTS.en.slowDown;
}

describe('Failed and limited requests', () => {
  /**
   * **Validates: Requirements 6.5, 6.7, 10.6, 10.7, 13.8, 19.12**
   */
  it('Feature: crypt-ouija-simulator, Property 33: Failed and limited requests keep the session view', () => {
    fc.assert(
      fc.property(failCaseArb, ({ state, action }) => {
        const next = sessionReducer(state, action);

        // Snapshot and Replies_Left unchanged in every case (6.5, 6.7, 10.6, 10.7, 13.8, 19.12).
        expect(next.snapshot).toBe(state.snapshot);
        expect(next.repliesLeft).toBe(state.repliesLeft);
        expect(next.epoch).toBe(state.epoch);
        expect(next.bubbles).toEqual(state.bubbles);
        expect(next.inFlight).toBeNull();

        if (action.request === 'message') {
          // Exactly one urgent note appended to the drip queue.
          expect(next.drip).toHaveLength(state.drip.length + 1);
          expect(next.drip.slice(0, state.drip.length)).toEqual(state.drip);
          expect(next.drip[state.drip.length]).toEqual({ kind: 'note', text: expectedNoteText(action), urgent: true });
          expect(next.waitingMessage).toBeNull();
          expect(next.retryAt).toEqual(state.retryAt);
          return;
        }

        // Deliver: no bubble or note, one retry 60,000 ms later for that Reminder_Id.
        expect(next.drip).toEqual(state.drip);
        expect(next.error).toBe(state.error);
        expect(next.waitingMessage).toEqual(state.waitingMessage);
        const id = action.reminderId;
        const expected = new Map(state.retryAt);
        if (id !== undefined && state.snapshot.reminders.some((r) => r.id === id)) {
          expected.set(id, action.browserNow + 60_000);
        }
        expect(next.retryAt).toEqual(expected);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
