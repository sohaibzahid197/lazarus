// Feature: crypt-ouija-simulator, Property 1: T9_Decoder matches the multi-tap model
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { keyEventsArb, t9ModeArb } from '../test/arbitraries/t9';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { referenceDecodeT9 } from '../test/t9.reference';
import { isT9Text } from './keymap';
import { decodeT9 } from './t9.decode';

describe('T9_Decoder multi-tap model', () => {
  /**
   * **Validates: Requirements 3.2, 4.1, 4.2, 4.3, 4.4, 4.5, 4.10**
   */
  it('Feature: crypt-ouija-simulator, Property 1: T9_Decoder matches the multi-tap model', () => {
    fc.assert(
      fc.property(t9ModeArb, keyEventsArb, (start, events) => {
        const first = decodeT9(events, start);
        const second = decodeT9(events, start);
        expect(second).toEqual(first); // same input, same output (4.1)

        const ref = referenceDecodeT9(events, start);
        expect(first).toEqual({ ok: true, text: ref.text, mode: ref.mode, pending: ref.pending });

        if (!first.ok) return;
        expect(isT9Text(first.text)).toBe(true); // totality (4.10)
        if (first.pending !== null) {
          expect(first.pending).toHaveLength(1);
          expect(isT9Text(first.pending)).toBe(true);
        }
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
