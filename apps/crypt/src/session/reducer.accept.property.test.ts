// Feature: crypt-ouija-simulator, Property 32: An accepted response replaces the session view
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SimulatorResponse } from '../protocol/wire.types';
import { browserNowArb, responseArb, sessionStateArb } from '../test/arbitraries/session';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { REPLY_LIMIT_NOTE } from '../ui/texts';
import { sessionReducer } from './session.reducer';
import type { DripItem, SessionState } from './session.types';

const LABELS = { en: 'English', ur: 'Urdu', 'roman-ur': 'Roman Urdu' } as const;

/** A state with a current-epoch `response` action whose request matches the response kind. */
const acceptedArb: fc.Arbitrary<{
  readonly state: SessionState;
  readonly response: SimulatorResponse;
  readonly browserNow: number;
}> = fc.record({ state: sessionStateArb, response: responseArb, browserNow: browserNowArb });

/** Checks the part items against the response: text, badge and first-part labels. */
function expectPartItems(items: readonly DripItem[], response: SimulatorResponse): void {
  const total = response.parts.length;
  const isMessage = response.kind === 'message';
  response.parts.forEach((part, i) => {
    const item = items[i];
    expect(item?.kind).toBe(isMessage ? 'part' : 'reminder-part');
    expect(item?.text).toBe(part.text);
    expect(item?.badge).toEqual({
      n: i + 1,
      total,
      encoding: response.encoding,
      units: part.units,
      limit: part.limit,
    });
    const first = i === 0;
    expect(item?.languageLabel).toBe(isMessage && first ? LABELS[response.language] : undefined);
    expect(item?.reminderLabel).toBe(!isMessage && first ? true : undefined);
  });
}

describe('Accepted responses', () => {
  /**
   * **Validates: Requirements 2.7, 6.4, 11.2, 11.3, 11.7, 13.7, 19.8, 19.10**
   */
  it('Feature: crypt-ouija-simulator, Property 32: An accepted response replaces the session view', () => {
    fc.assert(
      fc.property(acceptedArb, ({ state, response, browserNow }) => {
        const next = sessionReducer(state, {
          type: 'response',
          epoch: state.epoch,
          request: response.kind,
          response,
          browserNow,
        });

        expect(next.snapshot).toBe(response.snapshot);
        expect(next.repliesLeft).toBe(response.repliesLeft);
        expect(next.epoch).toBe(state.epoch);
        expect(next.bubbles).toBe(state.bubbles);
        expect(next.drip.slice(0, state.drip.length)).toEqual(state.drip);

        const added = next.drip.slice(state.drip.length);
        const n = response.parts.length;

        if (n === 0) {
          // 0-part message: one Status_Note; 0-part deliver: a note only with a Delivery_Outcome (11.7).
          const notes = response.kind === 'message' || response.deliveryOutcome !== null ? 1 : 0;
          expect(added).toHaveLength(notes);
          added.forEach((item) => {
            expect(item.kind).toBe('note');
            expect(item.badge).toBeUndefined();
          });
          return;
        }

        expectPartItems(added, response);
        const limitNote = response.kind === 'message' && response.outcome === 'rate-limited' && n === 1;
        if (limitNote) {
          expect(added).toHaveLength(n + 1);
          expect(added[n]).toEqual({ kind: 'note', text: REPLY_LIMIT_NOTE });
        } else {
          expect(added).toHaveLength(n);
        }
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
