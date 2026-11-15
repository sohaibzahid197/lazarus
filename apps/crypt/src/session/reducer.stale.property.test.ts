// Feature: crypt-ouija-simulator, Property 31: Stale responses change nothing
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { staleActionArb } from '../test/arbitraries/session';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { sessionReducer } from './session.reducer';
import type { SessionState } from './session.types';

/** A deep copy of the state, so the test also sees any in-place mutation. */
function cloneState(s: SessionState): SessionState {
  return {
    ...s,
    snapshot: structuredClone(s.snapshot),
    bubbles: structuredClone(s.bubbles),
    drip: structuredClone(s.drip),
    retryAt: new Map(s.retryAt),
    recheckAt: new Map(s.recheckAt),
  };
}

describe('Stale responses', () => {
  /**
   * **Validates: Requirements 6.8, 19.4**
   */
  it('Feature: crypt-ouija-simulator, Property 31: Stale responses change nothing', () => {
    fc.assert(
      fc.property(staleActionArb, ({ state, action }) => {
        expect(action.epoch).not.toBe(state.epoch);
        const before = cloneState(state);

        const next = sessionReducer(state, action);

        expect(next).toBe(state);
        expect(state).toEqual(before);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
