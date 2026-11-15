// Feature: necromancer-sms-gateway, Property 2: Normalizing a Canonical_Number is idempotent
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GATEWAY_PBT_OPTIONS, canonicalNumber, countryCode } from './gateway.arbitraries.js';
import { normalizeSender } from './gateway.number.js';

describe('gateway.number idempotence', () => {
  /** **Validates: Requirements 2.6** */
  it('Req 2.6: normalizing a Canonical_Number returns it unchanged for any country code', () => {
    fc.assert(
      fc.property(canonicalNumber, countryCode, (number, cc) => {
        expect(normalizeSender(number, cc)).toEqual({ kind: 'phone', number });
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
