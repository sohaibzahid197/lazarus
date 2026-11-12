// Property-based tests for the SMS code-unit counting module.
//
// Each property is a single `fc.assert(fc.property(...))` test that runs a
// minimum of 100 fast-check iterations and is tagged with its design
// property number and the requirement clause it validates.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { countCodeUnits } from './units.js';
import { isGsm7Basic, isGsm7Extension } from './encoding.js';
import { gsm7TextArb } from './arbitraries.js';

// Feature: sms-message-splitter, Property 7: Extension characters count as two code units
// Validates: Requirements 5.1
//
// For any Reply_Text consisting solely of GSM-7 characters, countCodeUnits
// returns the number of basic characters times one plus the number of
// extension characters times two. The oracle (scanning every code point
// with `isGsm7Basic`/`isGsm7Extension`) is an independent re-implementation
// of the per-character weighting that countCodeUnits must match.
describe('SMS Message Splitter — Property 7: Extension characters count as two code units', () => {
  it('countCodeUnits(text, GSM-7) equals (#basic)*1 + (#extension)*2', () => {
    fc.assert(
      fc.property(gsm7TextArb, (text: string) => {
        let expected = 0;
        for (const ch of text) {
          if (isGsm7Extension(ch)) {
            expected += 2;
          } else if (isGsm7Basic(ch)) {
            expected += 1;
          }
        }
        expect(countCodeUnits(text, 'GSM-7')).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});
