// Property-based test: part prefixing.
//
// Single-part replies carry no prefix and are never stripped on join;
// multi-part replies carry `(n/total) ` on every part and `joinSms` strips
// exactly one leading prefix per part.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { splitSms, joinSms } from './index.js';
import { anyTextArb } from './arbitraries.js';

// Long GSM-7 text (multi-part, sometimes beyond the 4-part cap => truncated).
const longGsm7Arb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom('a', 'b', 'z', ' ', '1', 'e', '{', '€'), {
    minLength: 150,
    maxLength: 800,
  })
  .map((chars: string[]) => chars.join(''));

// Long UCS-2 text (multi-part, sometimes truncated).
const longUcs2Arb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom('a', ' ', 'ب', 'ک', '😀', '🚀'), {
    minLength: 60,
    maxLength: 400,
  })
  .map((chars: string[]) => 'ا' + chars.join(''));

// Short texts that begin with a prefix-shaped token.
const prefixShapedArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 1, max: 9 }),
    fc.integer({ min: 1, max: 9 }),
    fc.string({ minLength: 0, maxLength: 40 }),
  )
  .map(([n, t, rest]: [number, number, string]) => `(${n}/${t}) ${rest}`);

function prefixingHolds(text: string): void {
  const parts = splitSms(text);
  if (parts.length === 1) {
    expect(parts[0]).toBe(text);
    expect(joinSms(parts)).toBe(text);
    return;
  }
  const total = parts.length;
  const prefixes = parts.map((_p: string, i: number) => `(${i + 1}/${total}) `);
  parts.forEach((part: string, i: number) => {
    expect(part.startsWith(prefixes[i] as string)).toBe(true);
  });
  const expected = parts
    .map((p: string, i: number) => p.slice((prefixes[i] as string).length))
    .join('');
  expect(joinSms(parts)).toBe(expected);
}

// Feature: sms-message-splitter, Property 9: Part prefixing
// Validates: Requirements 7.1, 7.3
describe('SMS Message Splitter — Property 9: Part prefixing', () => {
  it('holds for arbitrary text', () => {
    fc.assert(
      fc.property(anyTextArb, (text: string) => {
        prefixingHolds(text);
      }),
      { numRuns: 100 },
    );
  });

  it('holds for long GSM-7 text', () => {
    fc.assert(
      fc.property(longGsm7Arb, (text: string) => {
        prefixingHolds(text);
      }),
      { numRuns: 100 },
    );
  });

  it('holds for long UCS-2 text', () => {
    fc.assert(
      fc.property(longUcs2Arb, (text: string) => {
        prefixingHolds(text);
      }),
      { numRuns: 100 },
    );
  });

  it('holds for prefix-shaped text', () => {
    fc.assert(
      fc.property(prefixShapedArb, (text: string) => {
        prefixingHolds(text);
      }),
      { numRuns: 100 },
    );
  });
});
