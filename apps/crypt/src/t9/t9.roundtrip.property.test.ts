// Feature: crypt-ouija-simulator, Property 7: T9 round trip
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { t9TextArb } from '../test/arbitraries/t9';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { decodeT9 } from './t9.decode';
import { encodeT9 } from './t9.encode';

describe('T9 round trip', () => {
  /**
   * **Validates: Requirements 4.9**
   */
  it('Feature: crypt-ouija-simulator, Property 7: T9 round trip', () => {
    fc.assert(
      fc.property(t9TextArb, (text) => {
        const encoded = encodeT9(text);
        expect(encoded.ok).toBe(true);
        if (!encoded.ok) return;

        const decoded = decodeT9(encoded.events, { entry: 'letter', letterCase: 'lower' });
        expect(decoded.ok).toBe(true);
        if (!decoded.ok) return;

        expect(decoded.text + (decoded.pending ?? '')).toBe(text);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
