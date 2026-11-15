// Feature: crypt-ouija-simulator, Property 2: T9_Decoder rejects bad press times
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { badTimeEventsArb, t9ModeArb } from '../test/arbitraries/t9';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { decodeT9 } from './t9.decode';

describe('T9_Decoder bad press times', () => {
  /**
   * **Validates: Requirements 4.6**
   */
  it('Feature: crypt-ouija-simulator, Property 2: T9_Decoder rejects bad press times', () => {
    fc.assert(
      fc.property(badTimeEventsArb, t9ModeArb, (events, start) => {
        const result = decodeT9(events, start);
        expect(result).toEqual({ ok: false, error: 'bad-time' });
        expect('text' in result).toBe(false);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
