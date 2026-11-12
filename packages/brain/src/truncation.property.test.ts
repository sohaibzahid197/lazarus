// Property-based test for hard-cap truncation of over-capacity replies.
//
// Oracle (independent of the production cut helpers): the first three
// content parts are taken from `splitContent`; the remaining text `rest`
// is then cut by a local re-implementation:
//   1. hard cut = longest code-point prefix of `rest` whose UTF-16 length is
//      <= contentBudget - 3 (all generated chars cost 1 unit per code unit
//      in both encodings, so code units are the cost measure);
//   2. word boundary = just after the latest space found within the last 15
//      code units before the hard cut, otherwise the hard cut itself.
// The final part must equal `(4/4) ` + rest.slice(0, cut) + '...'.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { splitSms } from './index.js';
import { detectEncoding } from './encoding.js';
import { splitContent } from './split.js';
import { getPartLimits } from './limits.js';

const PREFIX = '(4/4) ';
const INDICATOR = '...';
const WINDOW = 15;

const asciiWordArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
    minLength: 1,
    maxLength: 12,
  })
  .map((cs: string[]) => cs.join(''));

const mixedWordArb: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom('ا', 'ب', 'ک', 'م', 'ن', 'پ', 'ت', 'a', 'b', 'c', '😀', '🎉', '🚀'),
    { minLength: 1, maxLength: 12 },
  )
  .map((cs: string[]) => cs.join(''));

function joinWords(words: string[]): string {
  return words.join(' ');
}

// GSM-7 flavour: >= 700 units. UCS-2 flavour: Urdu/emoji, >= 300 units.
const overCapacityTextArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .array(asciiWordArb, { minLength: 100, maxLength: 200 })
    .map(joinWords)
    .filter((t: string) => t.length >= 700),
  fc
    .tuple(
      mixedWordArb,
      fc.array(mixedWordArb, { minLength: 60, maxLength: 150 }),
    )
    // Guarantee at least one non-GSM-7 char so the text is UCS-2.
    .map(([w, ws]: [string, string[]]) => joinWords(['ا' + w, ...ws]))
    .filter((t: string) => t.length >= 300),
);

function oracleCut(rest: string, budget: number): number {
  let hard = 0;
  for (const ch of rest) {
    if (hard + ch.length > budget) break;
    hard += ch.length;
  }
  for (let i = hard - 1; i >= Math.max(0, hard - WINDOW); i--) {
    if (rest[i] === ' ') return i + 1;
  }
  return hard;
}

// Feature: sms-message-splitter, Property 10: Truncation behavior for over-cap replies
// Validates: Requirements 9.2, 9.3, 9.5
describe('SMS Message Splitter — Property 10: Truncation behavior for over-cap replies', () => {
  it('yields exactly 4 parts, ends with "...", and cuts at the expected boundary', () => {
    fc.assert(
      fc.property(overCapacityTextArb, (text: string) => {
        const encoding = detectEncoding(text);
        const content = splitContent(text, encoding);
        fc.pre(content.length > 4);

        const parts = splitSms(text);
        expect(parts).toHaveLength(4);

        const last = parts[3] as string;
        expect(last.startsWith(PREFIX)).toBe(true);
        expect(last.endsWith(INDICATOR)).toBe(true);

        const contentBudget = getPartLimits(encoding).multi - PREFIX.length;
        const consumed = content.slice(0, 3).join('').length;
        const rest = text.slice(consumed);
        const cut = oracleCut(rest, contentBudget - INDICATOR.length);

        expect(last).toBe(PREFIX + rest.slice(0, cut) + INDICATOR);
        // Part 4 stays within the per-part limit.
        expect(last.length).toBeLessThanOrEqual(getPartLimits(encoding).multi);
      }),
      { numRuns: 100 },
    );
  });
});
