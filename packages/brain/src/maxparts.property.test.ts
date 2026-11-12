// Property-based test: a reply never exceeds 4 SMS parts.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { splitSms } from './index.js';
import { anyTextArb } from './arbitraries.js';

const wordChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?';

// Very long GSM-7 text with spaces (up to several thousand characters).
const longGsm7SpacedArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...(wordChars + '      ').split('')), {
    minLength: 200,
    maxLength: 5000,
  })
  .map((chars: string[]) => chars.join(''));

// Very long GSM-7 text without any spaces.
const longGsm7NoSpaceArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...wordChars.split('')), {
    minLength: 200,
    maxLength: 5000,
  })
  .map((chars: string[]) => chars.join(''));

// Very long UCS-2 text: Urdu letters and emoji, with and without spaces.
const ucs2CharArb: fc.Arbitrary<string> = fc.constantFrom(
  'ا', 'ب', 'پ', 'ت', 'س', 'ک', 'م', 'ن', 'و', 'ہ', ' ', ' ', '😀', '🧟', '💀',
);
const longUcs2Arb: fc.Arbitrary<string> = fc
  .array(ucs2CharArb, { minLength: 100, maxLength: 4000 })
  .map((chars: string[]) => chars.join(''));
const longUcs2NoSpaceArb: fc.Arbitrary<string> = fc
  .array(ucs2CharArb.filter((c: string) => c !== ' '), {
    minLength: 100,
    maxLength: 4000,
  })
  .map((chars: string[]) => chars.join(''));

function atMostFourParts(text: string): void {
  expect(splitSms(text).length).toBeLessThanOrEqual(4);
}

// Feature: sms-message-splitter, Property 4: Maximum 4 parts produced
// Validates: Requirements 9.1
describe('SMS Message Splitter — Property 4: Maximum 4 parts produced', () => {
  it('holds for arbitrary short text', () => {
    fc.assert(fc.property(anyTextArb, atMostFourParts), { numRuns: 100 });
  });

  it('holds for very long GSM-7 text with spaces', () => {
    fc.assert(fc.property(longGsm7SpacedArb, atMostFourParts), { numRuns: 100 });
  });

  it('holds for very long GSM-7 text without spaces', () => {
    fc.assert(fc.property(longGsm7NoSpaceArb, atMostFourParts), { numRuns: 100 });
  });

  it('holds for very long UCS-2 text with emoji', () => {
    fc.assert(fc.property(longUcs2Arb, atMostFourParts), { numRuns: 100 });
  });

  it('holds for very long UCS-2 text without spaces', () => {
    fc.assert(fc.property(longUcs2NoSpaceArb, atMostFourParts), { numRuns: 100 });
  });
});
