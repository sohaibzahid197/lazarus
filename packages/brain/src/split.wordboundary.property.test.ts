// Property-based tests for word-boundary split preference.
//
// Each property is a single `fc.assert(fc.property(...))` test that runs a
// minimum of 100 fast-check iterations and is tagged with its design
// property number and the requirement clause it validates.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { SmsEncoding } from './encoding.js';
import { findCutByBudget, splitContent } from './split.js';

// Independent restatement of the rules under test (not imported).
const WINDOW = 15;
const PREFIX_UNITS = 6; // "(1/4) "
const MULTI_LIMIT: Record<SmsEncoding, number> = { 'GSM-7': 153, 'UCS-2': 67 };

// Words of lowercase letters separated by single spaces. 40–80 words of
// 1–10 letters comfortably exceeds 160 units and spans several parts.
const wordArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
    minLength: 1,
    maxLength: 10,
  })
  .map((chars: string[]) => chars.join(''));

const gsm7TextArb: fc.Arbitrary<string> = fc
  .array(wordArb, { minLength: 40, maxLength: 80 })
  .map((words: string[]) => words.join(' '));

// Same shape, but opened with an Urdu word (forces UCS-2) and an emoji word
// so surrogate pairs are in play too.
const ucs2TextArb: fc.Arbitrary<string> = fc
  .array(wordArb, { minLength: 30, maxLength: 60 })
  .map((words: string[]) => ['اردو', '😀', ...words].join(' '));

/**
 * Independent oracle: the expected length of the next part. Starts from the
 * hard budget cut, then looks for the latest space in the last 15 units.
 */
function expectedCut(remaining: string, encoding: SmsEncoding): number {
  const budget = MULTI_LIMIT[encoding] - PREFIX_UNITS;
  const hardCut = Math.max(1, findCutByBudget(remaining, budget, encoding));
  // Property 8 concerns non-final parts only: a remainder that fits the
  // budget is emitted whole.
  if (hardCut >= remaining.length) {
    return remaining.length;
  }
  for (let i = hardCut - 1; i >= Math.max(0, hardCut - WINDOW); i--) {
    if (remaining[i] === ' ') {
      return i + 1;
    }
  }
  return hardCut;
}

function assertWordBoundaries(
  text: string,
  encoding: SmsEncoding,
  minParts: number,
): void {
  const parts = splitContent(text, encoding);
  expect(parts.length).toBeGreaterThanOrEqual(minParts);
  let remaining = text;
  for (const part of parts) {
    expect(part.length).toBe(expectedCut(remaining, encoding));
    remaining = remaining.slice(part.length);
  }
  expect(remaining).toBe('');
  expect(parts.join('')).toBe(text);
}

// Feature: sms-message-splitter, Property 8: Word-boundary split preference
// Validates: Requirements 6.2, 6.3
describe('SMS Message Splitter — Property 8: Word-boundary split preference', () => {
  it('GSM-7: every part ends after the latest space in the last 15 units, else at the hard cut', () => {
    fc.assert(
      fc.property(gsm7TextArb, (text: string) => {
        expect(text.length).toBeGreaterThan(160);
        assertWordBoundaries(text, 'GSM-7', 2);
      }),
      { numRuns: 100 },
    );
  });

  it('UCS-2: every part ends after the latest space in the last 15 units, else at the hard cut', () => {
    fc.assert(
      fc.property(ucs2TextArb, (text: string) => {
        expect(text.length).toBeGreaterThan(70);
        assertWordBoundaries(text, 'UCS-2', 2);
      }),
      { numRuns: 100 },
    );
  });

  it('prefers a space within the last 15 units of the part', () => {
    // Budget is 147; the space sits at index 140, inside the window.
    const text = 'a'.repeat(140) + ' ' + 'b'.repeat(100);
    const parts = splitContent(text, 'GSM-7');
    expect(parts[0]).toBe('a'.repeat(140) + ' ');
    expect(parts.join('')).toBe(text);
  });

  it('hard-cuts at the budget when no space is in the window', () => {
    // The only space is at index 100, well outside the last 15 of 147.
    const text = 'a'.repeat(100) + ' ' + 'b'.repeat(200);
    const parts = splitContent(text, 'GSM-7');
    expect(parts[0]?.length).toBe(147);
    expect(parts.join('')).toBe(text);
  });
});
