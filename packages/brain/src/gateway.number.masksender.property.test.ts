// Property-based tests for `maskSender` (`gateway.number.ts`).
//
// Runs at least 100 fast-check iterations (GATEWAY_PBT_OPTIONS).
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { maskSender, normalizeSender } from './gateway.number.js';
import { GATEWAY_PBT_OPTIONS, automatedAddress, countryCode } from './gateway.arbitraries.js';

const MASK = '•';

/** Any string: automated senders, short strings, and full UTF-16 strings. */
const anyAddress: fc.Arbitrary<string> = fc.oneof(
  automatedAddress,
  fc.string({ maxLength: 4 }),
  fc.string(),
  fc.string({ unit: 'binary' }),
);

describe('maskSender properties', () => {
  // Feature: necromancer-sms-gateway, Property 5: Masked sender shape
  // **Validates: Requirements 2.13, 7.6, 14.2**
  it('Property 5 (Req 2.13, 7.6, 14.2): masked sender keeps the last 3 units and masks the rest', () => {
    fc.assert(
      fc.property(anyAddress, (s) => {
        const masked = maskSender(s);
        if (s.length === 0) {
          expect(masked).toBe(MASK);
        } else if (s.length <= 3) {
          expect(masked).toBe(s);
        } else {
          expect(masked.length).toBe(s.length);
          expect(masked.slice(-3)).toBe(s.slice(-3));
          expect(masked.slice(0, -3)).toBe(MASK.repeat(s.length - 3));
        }
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });

  // Feature: necromancer-sms-gateway, Property 5: Masked sender shape
  // **Validates: Requirements 2.13, 7.6, 14.2**
  it('Property 5 (Req 2.13, 7.6, 14.2): automated senders carry maskSender(address)', () => {
    fc.assert(
      fc.property(automatedAddress, fc.option(countryCode, { nil: undefined }), (address, cc) => {
        const identity = normalizeSender(address, cc);
        expect(identity).toEqual({ kind: 'automated', masked: maskSender(address) });
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
