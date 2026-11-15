// Feature: crypt-ouija-simulator, Property 10: Switching Input_Mode commits the Pending_Character only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { keyEventsArb, t9ModeArb } from '../test/arbitraries/t9';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { initialT9State, pendingOf, stepT9, type T9State } from '../t9/t9.step';
import { switchInputMode } from './compose';

/** A T9State reached by real key presses, so open groups and every mode occur. */
const t9StateArb: fc.Arbitrary<T9State> = fc
  .tuple(t9ModeArb, keyEventsArb)
  .map(([mode, events]) => events.reduce(stepT9, initialT9State(mode)));

/** Compose_Field text: any Unicode, including Urdu, emoji and line breaks (5.1). */
const composeTextArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: 60 }),
  fc.string({ unit: 'binary', maxLength: 60 }),
  fc.constantFrom('', 'HELP', 'آج موسم کیسا ہے؟', 'kya\nhal 👻'),
);

describe('Input_Mode switch', () => {
  /**
   * **Validates: Requirements 5.3**
   */
  it('Feature: crypt-ouija-simulator, Property 10: Switching Input_Mode commits the Pending_Character only', () => {
    fc.assert(
      fc.property(composeTextArb, t9StateArb, (text, t9) => {
        const pending = pendingOf(t9);
        const out = switchInputMode(text, t9);

        expect(out.text).toBe(pending === null ? text : text + pending);
        expect(pendingOf(out.t9)).toBeNull(); // the Pending_Character is committed, not kept
        expect(out.t9.mode).toEqual(t9.mode); // T9 mode and case unchanged
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
