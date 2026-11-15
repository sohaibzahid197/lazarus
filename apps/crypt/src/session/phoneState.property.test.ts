// Feature: crypt-ouija-simulator, Property 36: Exactly one Phone_Mock state by precedence
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sessionStateArb } from '../test/arbitraries/session';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { phoneState } from './session.reducer';
import type { SessionState } from './session.types';

/**
 * A SessionState where each condition of the precedence rule is switched off
 * at random, so every state (including the rare idle ALIVE) is reached often.
 */
const stateArb: fc.Arbitrary<SessionState> = fc
  .record({
    base: sessionStateArb,
    clearInFlight: fc.boolean(),
    clearWaiting: fc.boolean(),
    clearDrip: fc.boolean(),
    clearError: fc.boolean(),
    stopped: fc.option(fc.boolean(), { nil: undefined }),
  })
  .map(({ base, clearInFlight, clearWaiting, clearDrip, clearError, stopped }): SessionState => ({
    ...base,
    inFlight: clearInFlight ? null : base.inFlight,
    waitingMessage: clearWaiting ? null : base.waitingMessage,
    drip: clearDrip ? [] : base.drip,
    error: clearError ? null : base.error,
    snapshot: stopped === undefined ? base.snapshot : { ...base.snapshot, stopped },
  }));

/** Expected state written from Requirements 14.2–14.6 and 11.5. */
function expectedState(s: SessionState): 'SENDING' | 'ERROR' | 'SLEEPING' | 'ALIVE' {
  const busy = s.inFlight !== null || s.waitingMessage !== null || s.drip.length > 0;
  if (busy) return 'SENDING';
  if (s.error !== null) return 'ERROR';
  return s.snapshot.stopped ? 'SLEEPING' : 'ALIVE';
}

describe('Phone_Mock state', () => {
  /**
   * **Validates: Requirements 11.5, 14.2, 14.3, 14.4, 14.6**
   */
  it('Feature: crypt-ouija-simulator, Property 36: Exactly one Phone_Mock state by precedence', () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        const state = phoneState(s);
        expect(['SENDING', 'ERROR', 'SLEEPING', 'ALIVE']).toContain(state);
        expect(state).toBe(expectedState(s));
        // SENDING wins even when STOP is on or an error is set (14.4).
        if (s.drip.length > 0 || s.inFlight !== null || s.waitingMessage !== null) {
          expect(state).toBe('SENDING');
        }
        // A pure function of the state: same answer twice.
        expect(phoneState(s)).toBe(state);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
