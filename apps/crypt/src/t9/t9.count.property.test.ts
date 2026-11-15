// Feature: crypt-ouija-simulator, Property 4: One character per group
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { digitKeyEventsArb } from '../test/arbitraries/t9';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { referenceDecodeT9 } from '../test/t9.reference';
import type { T9Mode } from './t9.step';
import { decodeT9 } from './t9.decode';

const LOWER_LETTER: T9Mode = { entry: 'letter', letterCase: 'lower' };

describe('T9_Decoder group count', () => {
  /**
   * **Validates: Requirements 4.12**
   */
  it('Feature: crypt-ouija-simulator, Property 4: One character per group', () => {
    fc.assert(
      fc.property(digitKeyEventsArb, (events) => {
        const result = decodeT9(events, LOWER_LETTER);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const { groups } = referenceDecodeT9(events, LOWER_LETTER);
        // Key_Map characters are single UTF-16 units, so length counts characters.
        const count = result.text.length + (result.pending === null ? 0 : 1);
        expect(count).toBe(groups);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
