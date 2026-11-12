// Property-based tests for surrogate-pair integrity when splitting.
//
// Each property is a single `fc.assert(fc.property(...))` test that runs a
// minimum of 100 fast-check iterations and is tagged with its design
// property number and the requirement clause it validates.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { splitContent } from './split.js';
import { isHighSurrogate, isLowSurrogate } from './units.js';

// Characters weighted towards emoji so surrogate pairs land on cut points
// often. `minLength: 71` guarantees more than 70 UCS-2 code units, which
// forces multi-part splitting.
const longEmojiTextArb: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      { arbitrary: fc.constantFrom('😀', '🎉', '🚀'), weight: 4 },
      { arbitrary: fc.constantFrom('ا', 'ب', 'ک', 'م'), weight: 2 },
      { arbitrary: fc.constantFrom('a', 'b', 'z', '1'), weight: 2 },
      { arbitrary: fc.constant(' '), weight: 1 },
    ),
    { minLength: 71, maxLength: 150 },
  )
  .map((chars: string[]) => chars.join(''));

function assertPartsAreSurrogateSafe(parts: string[], original: string): void {
  for (const part of parts) {
    expect(part.length).toBeGreaterThan(0);
    expect(isHighSurrogate(part.charCodeAt(part.length - 1))).toBe(false);
    expect(isLowSurrogate(part.charCodeAt(0))).toBe(false);
  }
  expect(parts.join('')).toBe(original);
}

// Feature: sms-message-splitter, Property 3: Surrogate pairs never split across parts
// Validates: Requirements 6.1
describe('SMS Message Splitter — Property 3: Surrogate pairs never split across parts', () => {
  it('no part ends with a high surrogate or starts with a low surrogate', () => {
    fc.assert(
      fc.property(longEmojiTextArb, (text: string) => {
        const parts = splitContent(text, 'UCS-2');
        expect(parts.length).toBeGreaterThan(1);
        assertPartsAreSurrogateSafe(parts, text);
      }),
      { numRuns: 100 },
    );
  });

  it('keeps an emoji that sits exactly on the split boundary intact', () => {
    // Content budget is 61; the emoji occupies code units 60 and 61, so a
    // naive cut at 61 would split it.
    const text = ('a'.repeat(60) + '😀').repeat(3);
    const parts = splitContent(text, 'UCS-2');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toBe('a'.repeat(60));
    expect(parts[1]?.startsWith('😀')).toBe(true);
    assertPartsAreSurrogateSafe(parts, text);
  });
});
