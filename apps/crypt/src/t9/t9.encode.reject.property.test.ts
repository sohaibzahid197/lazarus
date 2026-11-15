// Feature: crypt-ouija-simulator, Property 6: T9_Encoder rejects non-T9 text
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_ARB_T9_CHARS, nonT9TextArb } from '../test/arbitraries/t9';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { isT9Text } from './keymap';
import { encodeT9 } from './t9.encode';

describe('T9_Encoder rejection', () => {
  /**
   * **Validates: Requirements 4.8**
   */
  it('Feature: crypt-ouija-simulator, Property 6: T9_Encoder rejects non-T9 text', () => {
    fc.assert(
      fc.property(nonT9TextArb, (text) => {
        // Guard the generator: at most 200 characters, with a non-T9 character.
        expect(Array.from(text).length).toBeLessThanOrEqual(MAX_ARB_T9_CHARS);
        expect(isT9Text(text)).toBe(false);

        const result = encodeT9(text);
        expect(result).toEqual({ ok: false, error: 'not-t9-text' });
        expect('events' in result).toBe(false); // no Key_Events
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
