// Feature: necromancer-sms-gateway, Property 3: Print then normalize round trip
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeSender, printNumber } from './gateway.number.js';
import { GATEWAY_PBT_OPTIONS, canonicalNumber, countryCode } from './gateway.arbitraries.js';

describe('printNumber / normalizeSender round trip', () => {
  /** **Validates: Requirements 2.7, 2.8** */
  it('Req 2.8: printNumber(c) is c, "+" and digits only, and normalizes back to c', () => {
    fc.assert(
      fc.property(canonicalNumber, fc.option(countryCode, { nil: undefined }), (c, cc) => {
        const printed = printNumber(c);
        expect(printed).toBe(c);
        expect(printed).toMatch(/^\+\d+$/);
        expect(normalizeSender(printed, cc)).toEqual({ kind: 'phone', number: c });
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
