// Feature: crypt-ouija-simulator, Property 37: Session_Reset clears everything but the note
import fc from 'fast-check';
import { DEFAULT_SETTINGS } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '../protocol/emptySnapshot';
import { browserNowArb, sessionStateArb } from '../test/arbitraries/session';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { NEW_SESSION_TEXT, SESSION_RESET_TEXT } from '../ui/texts';
import { sessionReducer } from './session.reducer';
import type { Action, SessionState } from './session.types';

/** Any state, a reset time, and which reset path to take. */
const resetArb: fc.Arbitrary<{
  readonly state: SessionState;
  readonly nowMs: number;
  readonly kind: 'new-session' | 'invalid-snapshot';
}> = fc.record({
  state: sessionStateArb,
  nowMs: browserNowArb,
  kind: fc.constantFrom('new-session' as const, 'invalid-snapshot' as const),
});

function resetAction(state: SessionState, nowMs: number, kind: 'new-session' | 'invalid-snapshot'): Action {
  return kind === 'new-session'
    ? { type: 'new-session', nowMs }
    : { type: 'invalid-snapshot', epoch: state.epoch, nowMs };
}

describe('Session_Reset', () => {
  /**
   * **Validates: Requirements 6.6, 11.9, 19.2, 19.5**
   */
  it('Feature: crypt-ouija-simulator, Property 37: Session_Reset clears everything but the note', () => {
    fc.assert(
      fc.property(resetArb, ({ state, nowMs, kind }) => {
        const next = sessionReducer(state, resetAction(state, nowMs, kind));

        // (b) the old epoch's in-flight response is now stale (19.4).
        expect(next.epoch).toBe(state.epoch + 1);
        // (a) empty Session_Snapshot (8.5).
        expect(next.snapshot).toEqual(emptySnapshot(nowMs));
        // (i) Replies_Left back to the brain limit.
        expect(next.repliesLeft).toBe(DEFAULT_SETTINGS.perNumberLimit);
        // (b) no request in flight or waiting message.
        expect(next.inFlight).toBeNull();
        expect(next.waitingMessage).toBeNull();
        // (c) no scheduled retry or recheck.
        expect(next.retryAt.size).toBe(0);
        expect(next.recheckAt.size).toBe(0);
        // (d) nothing left to drip (11.9).
        expect(next.drip).toEqual([]);
        // (h) error state cleared.
        expect(next.error).toBeNull();
        // (e) and (j): exactly one bubble, the reset note.
        const note = kind === 'new-session' ? NEW_SESSION_TEXT : SESSION_RESET_TEXT;
        expect(next.bubbles).toHaveLength(1);
        const only = next.bubbles[0];
        expect(only?.kind).toBe('note');
        expect(only?.text).toBe(note);
        expect(only?.badge).toBeUndefined();
        expect(only?.urgent).toBeUndefined();
        // Bubble ids keep growing, so the note is never mistaken for an announced bubble.
        expect(only?.id).toBeGreaterThanOrEqual(state.nextBubbleId);
        expect(next.nextBubbleId).toBeGreaterThan(only?.id ?? Number.POSITIVE_INFINITY);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
