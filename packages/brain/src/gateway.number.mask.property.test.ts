// Feature: necromancer-sms-gateway, Property 4: Masked number invariant
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GATEWAY_PBT_OPTIONS, canonicalNumber } from './gateway.arbitraries.js';
import { maskNumber } from './gateway.number.js';

describe('maskNumber invariant', () => {
  /** **Validates: Requirements 2.9, 2.10** */
  it('Req 2.10: masked number keeps "+", length and the last 3 digits; every other char is "•"', () => {
    fc.assert(
      fc.property(canonicalNumber, (c) => {
        const masked = maskNumber(c);
        expect(masked.startsWith('+')).toBe(true);
        expect(masked.length).toBe(c.length);
        const digits = masked.replace(/\D/g, '');
        expect(digits).toBe(c.slice(-3));
        const rest = masked.slice(1, masked.length - 3);
        expect([...rest].every((ch) => ch === '•')).toBe(true);
        expect(masked.slice(-3)).toBe(c.slice(-3));
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
