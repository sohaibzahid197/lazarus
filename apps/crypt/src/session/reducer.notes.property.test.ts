// Feature: crypt-ouija-simulator, Property 34: Every 0-part outcome gets its one note
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DeliveryOutcome, Outcome } from '@lazarus/brain';
import type { SimulatorResponse } from '../protocol/wire.types';
import { deliverResponseArb, messageResponseArb, sessionStateArb, browserNowArb } from '../test/arbitraries/session';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { sessionReducer } from './session.reducer';

// Expected texts copied literally from Requirements 11.6 and 13.11, so the test
// does not depend on outcomeNotes.ts.
function expectedMessageNote(outcome: Outcome | null): string {
  if (outcome === 'ignored-stopped') return 'No reply: this number texted STOP. Send START to get replies again.';
  if (outcome === 'rate-limited') return 'No reply: reply limit for this number reached. Press New session to keep testing.';
  if (outcome === 'send-capped') return 'No reply: daily send limit reached. Press New session to keep testing.';
  return 'No reply.';
}

function expectedDeliveryNote(outcome: DeliveryOutcome): string {
  if (outcome === 'reminder-stopped') return 'Reminder not sent: STOP is on.';
  if (outcome === 'reminder-expired') return 'Reminder not sent: it was more than 1 hour late.';
  if (outcome === 'reminder-capped') {
    return 'Reminder not sent: daily send limit reached. Press New session to keep testing.';
  }
  return 'Reminder not sent.';
}

/** A 0-part response that must get a note: any message response, or a deliver with a Delivery_Outcome. */
const zeroPartArb: fc.Arbitrary<{ readonly response: SimulatorResponse; readonly expected: string }> = fc.oneof(
  messageResponseArb
    .filter((r) => r.parts.length === 0)
    .map((response) => ({ response, expected: expectedMessageNote(response.outcome) })),
  deliverResponseArb
    .filter((r) => r.parts.length === 0 && r.deliveryOutcome !== null)
    .map((response) => ({
      response,
      expected: response.deliveryOutcome === null ? '' : expectedDeliveryNote(response.deliveryOutcome),
    })),
);

describe('0-part outcome notes', () => {
  /**
   * **Validates: Requirements 11.6, 13.11**
   */
  it('Feature: crypt-ouija-simulator, Property 34: Every 0-part outcome gets its one note', () => {
    fc.assert(
      fc.property(sessionStateArb, zeroPartArb, browserNowArb, (state, { response, expected }, browserNow) => {
        const next = sessionReducer(state, {
          type: 'response',
          epoch: state.epoch,
          request: response.kind,
          response,
          browserNow,
        });

        // Existing bubbles and queued drip items stay; exactly one item is appended.
        expect(next.bubbles).toEqual(state.bubbles);
        expect(next.drip.slice(0, state.drip.length)).toEqual(state.drip);
        const added = next.drip.slice(state.drip.length);
        expect(added).toHaveLength(1);

        const [note] = added;
        expect(note?.kind).toBe('note');
        expect(note?.text).toBe(expected);
        expect(note?.badge).toBeUndefined();
        expect(note?.languageLabel).toBeUndefined();
        expect(note?.reminderLabel).toBeUndefined();
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
