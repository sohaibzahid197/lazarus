// Property-based test: a reply is a single part iff it fits the single limit.
//
// A single `fc.assert(fc.property(...))` test per input region, each running a
// minimum of 100 fast-check iterations and tagged with its design property
// number and the requirement clauses it validates.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { splitSms } from './index.js';
import { detectEncoding } from './encoding.js';
import { getPartLimits } from './limits.js';
import { countCodeUnits } from './units.js';
import { anyTextArb } from './arbitraries.js';

// GSM-7 texts of ~145-175 characters, mostly basic with some extension chars
// (each counting 2 units), so the unit total straddles the 160 boundary.
const nearGsm7BoundaryArb: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      { weight: 12, arbitrary: fc.constantFrom('a', 'b', 'z', ' ', '1') },
      { weight: 1, arbitrary: fc.constantFrom('{', '}', '[', ']', '€', '^') },
    ),
    { minLength: 145, maxLength: 175 },
  )
  .map((chars: string[]) => chars.join(''));

// UCS-2 texts of ~55-80 characters with at least one Urdu letter and some
// emoji (2 units each), so the unit total straddles the 70 boundary.
const nearUcs2BoundaryArb: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      { weight: 8, arbitrary: fc.constantFrom('a', ' ', 'ب', 'ک') },
      { weight: 1, arbitrary: fc.constantFrom('😀', '🎉', '🚀') },
    ),
    { minLength: 55, maxLength: 80 },
  )
  .map((chars: string[]) => 'ا' + chars.join(''));

function singlePartIffWithinLimit(text: string): void {
  const encoding = detectEncoding(text);
  const total = countCodeUnits(text, encoding);
  const { single } = getPartLimits(encoding);
  const count = splitSms(text).length;
  if (total <= single) {
    expect(count).toBe(1);
  } else {
    expect(count).toBeGreaterThanOrEqual(2);
  }
}

// Feature: sms-message-splitter, Property 6: Single-part iff within single limit
// Validates: Requirements 2.2, 2.3
describe('SMS Message Splitter — Property 6: Single-part iff within single limit', () => {
  it('holds for arbitrary text', () => {
    fc.assert(
      fc.property(anyTextArb, (text: string) => {
        singlePartIffWithinLimit(text);
      }),
      { numRuns: 100 },
    );
  });

  it('holds for GSM-7 text near the 160-unit boundary', () => {
    fc.assert(
      fc.property(nearGsm7BoundaryArb, (text: string) => {
        singlePartIffWithinLimit(text);
      }),
      { numRuns: 200 },
    );
  });

  it('holds for UCS-2 text near the 70-unit boundary', () => {
    fc.assert(
      fc.property(nearUcs2BoundaryArb, (text: string) => {
        singlePartIffWithinLimit(text);
      }),
      { numRuns: 200 },
    );
  });
});
