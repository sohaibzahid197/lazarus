// Property-based tests for the SMS encoding-detection module.
//
// Each property is a single `fc.assert(fc.property(...))` test that runs a
// minimum of 100 fast-check iterations and is tagged with its design
// property number and the requirement clause it validates.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { detectEncoding, isGsm7 } from './encoding.js';
import { anyTextArb } from './arbitraries.js';

// Feature: sms-message-splitter, Property 5: Encoding detection is whole-message
// Validates: Requirements 4.1
//
// For any Reply_Text, detectEncoding(text) is 'UCS-2' if and only if at least
// one character is not a GSM-7 character, and 'GSM-7' otherwise. The oracle
// (scanning every code point with `isGsm7`) is an independent re-implementation
// of the whole-message aggregation that detectEncoding must match.
describe('SMS Message Splitter — Property 5: Encoding detection is whole-message', () => {
  it('detectEncoding(text) is UCS-2 iff some character is non-GSM-7', () => {
    fc.assert(
      fc.property(anyTextArb, (text: string) => {
        const hasNonGsm7 = [...text].some((ch: string) => !isGsm7(ch));
        expect(detectEncoding(text)).toBe(hasNonGsm7 ? 'UCS-2' : 'GSM-7');
      }),
      { numRuns: 100 },
    );
  });
});
