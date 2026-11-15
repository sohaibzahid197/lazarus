// Feature: crypt-ouija-simulator, Property 9: Clear removes exactly one thing
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { keyEventsArb, t9ModeArb } from '../test/arbitraries/t9';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { initialT9State, pendingOf, stepT9, type T9State } from '../t9/t9.step';
import { clearLast } from './compose';

/** A T9State reached by real key presses, so open groups and every mode occur. */
const t9StateArb: fc.Arbitrary<T9State> = fc
  .tuple(t9ModeArb, keyEventsArb)
  .map(([mode, events]) => events.reduce(stepT9, initialT9State(mode)));

/**
 * Compose_Field text units: ASCII, Urdu, emoji (surrogate pairs) and lone
 * surrogates, so the "last code point" rule is tested at its edges.
 */
const unitArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('a', 'Z', '7', ' ', '\n', '?'),
  fc.constantFrom('م', 'د', 'ے', '؟'),
  fc.constantFrom('😀', '👻', '𝄞'),
  fc.constantFrom('\uD83D', '\uDC7B'),
  fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }),
);
const composeTextArb: fc.Arbitrary<string> = fc.string({ unit: unitArb, minLength: 0, maxLength: 40 });

/** Last code point the way the Clear_Key sees it: a pair whole, a lone surrogate alone. */
function lastCodePoint(text: string): string {
  const points = Array.from(text);
  return points[points.length - 1] ?? '';
}

describe('Clear_Key', () => {
  /**
   * **Validates: Requirements 3.8**
   */
  it('Feature: crypt-ouija-simulator, Property 9: Clear removes exactly one thing', () => {
    fc.assert(
      fc.property(composeTextArb, t9StateArb, (text, t9) => {
        const out = clearLast(text, t9);

        if (pendingOf(t9) !== null) {
          // Only the Pending_Character goes; committed text and T9 mode stay.
          expect(out.text).toBe(text);
          expect(pendingOf(out.t9)).toBeNull();
          expect(out.t9.mode).toEqual(t9.mode);
          return;
        }

        expect(out.t9).toEqual(t9);
        if (text.length === 0) {
          expect(out.text).toBe('');
          return;
        }
        const removed = lastCodePoint(text);
        expect(removed.length).toBeGreaterThan(0);
        expect(out.text + removed).toBe(text);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
