// Property-based tests for SMS split/join round-trip reconstruction.
//
// Each property is a single `fc.assert(fc.property(...))` test that runs a
// minimum of 100 fast-check iterations and is tagged with its design
// property number and the requirement clause it validates.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { joinSms, splitSms } from './index.js';
import { detectEncoding } from './encoding.js';
import { splitContent } from './split.js';
import { MAX_PARTS } from './limits.js';
import { anyTextArb, gsm7TextArb, ucs2TextArb } from './arbitraries.js';

// Longer texts (several parts) built from words and spaces, in either
// encoding. Filtered so the greedy split needs at most MAX_PARTS parts, i.e.
// no hard-cap truncation occurs and the round trip must be exact.
const longTextArb: fc.Arbitrary<string> = fc
  .array(fc.oneof(gsm7TextArb, ucs2TextArb, fc.constant(' ')), {
    minLength: 1,
    maxLength: 40,
  })
  .map((chunks: string[]) => chunks.join(''))
  .filter(
    (t: string) => splitContent(t, detectEncoding(t)).length <= MAX_PARTS,
  );

// A part-prefix-shaped token followed by short GSM-7 text, total <= 160
// units so the result is a single (unprefixed) part.
const prefixShapedSingleArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('(1/2) ', '(2/2) ', '(1/3) ', '(3/4) ', '(4/4) '),
    gsm7TextArb,
  )
  .map(([token, rest]: [string, string]) => token + rest);

// Feature: sms-message-splitter, Property 1: Round-trip reconstruction
// Validates: Requirements 8.2
describe('SMS Message Splitter — Property 1: Round-trip reconstruction', () => {
  it('joinSms(splitSms(t)) === t for short arbitrary text', () => {
    fc.assert(
      fc.property(anyTextArb, (text: string) => {
        expect(joinSms(splitSms(text))).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it('joinSms(splitSms(t)) === t for longer text needing <= 4 parts', () => {
    fc.assert(
      fc.property(longTextArb, (text: string) => {
        expect(joinSms(splitSms(text))).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it('prefix-shaped single-part text is returned unchanged', () => {
    fc.assert(
      fc.property(prefixShapedSingleArb, (text: string) => {
        expect(splitSms(text)).toEqual([text]);
        expect(joinSms(splitSms(text))).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it('keeps a prefix-shaped single part intact (example)', () => {
    expect(splitSms('(1/2) Hello')).toEqual(['(1/2) Hello']);
  });
});
