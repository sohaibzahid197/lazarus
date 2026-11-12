// Property-based tests: no SMS part exceeds its encoding limit.
//
// Each property is a single `fc.assert(fc.property(...))` test that runs a
// minimum of 100 fast-check iterations and is tagged with its design
// property number and the requirement clauses it validates.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { splitSms } from './index.js';
import { detectEncoding } from './encoding.js';
import { getPartLimits } from './limits.js';
import { countCodeUnits } from './units.js';
import { anyTextArb, gsm7TextArb, ucs2TextArb } from './arbitraries.js';

// Long GSM-7 texts: several hundred to a few thousand characters, including
// over-capacity inputs that trigger the 4-part truncation.
const longGsm7Arb: fc.Arbitrary<string> = fc
  .array(fc.oneof(gsm7TextArb, fc.constant(' ')), {
    minLength: 10,
    maxLength: 80,
  })
  .map((chunks: string[]) => chunks.join(''));

// Long UCS-2 texts: same shape, with at least one non-GSM-7 chunk.
const longUcs2Arb: fc.Arbitrary<string> = fc
  .tuple(
    ucs2TextArb,
    fc.array(fc.oneof(gsm7TextArb, ucs2TextArb, fc.constant(' ')), {
      minLength: 10,
      maxLength: 80,
    }),
  )
  .map(([required, chunks]: [string, string[]]) => required + chunks.join(''));

function allPartsWithinLimit(text: string): void {
  const encoding = detectEncoding(text);
  const parts = splitSms(text);
  const { single, multi } = getPartLimits(encoding);
  const limit = parts.length === 1 ? single : multi;
  for (const part of parts) {
    expect(countCodeUnits(part, encoding)).toBeLessThanOrEqual(limit);
  }
}

// Feature: sms-message-splitter, Property 2: No part exceeds its encoding limit
// Validates: Requirements 3.1, 3.2, 4.2, 4.3, 7.2, 9.4
describe('SMS Message Splitter — Property 2: No part exceeds its encoding limit', () => {
  it('holds for arbitrary short text', () => {
    fc.assert(
      fc.property(anyTextArb, (text: string) => {
        allPartsWithinLimit(text);
      }),
      { numRuns: 100 },
    );
  });

  it('holds for long GSM-7 text, including truncated input', () => {
    fc.assert(
      fc.property(longGsm7Arb, (text: string) => {
        allPartsWithinLimit(text);
      }),
      { numRuns: 100 },
    );
  });

  it('holds for long UCS-2 text, including truncated input', () => {
    fc.assert(
      fc.property(longUcs2Arb, (text: string) => {
        allPartsWithinLimit(text);
      }),
      { numRuns: 100 },
    );
  });
});
