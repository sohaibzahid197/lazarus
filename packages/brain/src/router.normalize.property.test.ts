import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeMessage } from './normalize.js';
import { routeCommand } from './router.js';
import { aliasArb, anyText, caseMutate, wsArb } from './router.arbitraries.js';

/** Odd whitespace: tab, newline, CR, NBSP, ideographic space, BOM. */
const oddWsArb: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '\r', '\u00A0', '\u3000', '\uFEFF'),
  minLength: 0,
  maxLength: 6,
});

/** Map printable ASCII (U+0021..U+007E) to fullwidth (U+FF01..U+FF5E). */
function toFullwidth(s: string): string {
  return Array.from(s)
    .map((c) => {
      const code = c.charCodeAt(0);
      return code >= 0x21 && code <= 0x7e ? String.fromCharCode(code + 0xfee0) : c;
    })
    .join('');
}

/** Alias (random case) + odd whitespace + tail, with optional leading/trailing odd whitespace. */
const aliasPrefixedArb: fc.Arbitrary<string> = fc
  .tuple(oddWsArb, aliasArb.chain((a) => caseMutate(a)), oddWsArb, wsArb, anyText, oddWsArb)
  .map(([lead, alias, ws1, ws2, tail, trail]) => `${lead}${alias}${ws1}${ws2}${tail}${trail}`);

/** Fullwidth-converted alias-prefixed messages, to exercise NFKC. */
const fullwidthArb: fc.Arbitrary<string> = fc
  .tuple(aliasArb, wsArb, fc.string({ maxLength: 100 }))
  .map(([alias, ws, tail]) => toFullwidth(`${alias}${ws}${tail}`));

const inputArb: fc.Arbitrary<string> = fc.oneof(
  anyText,
  fc.string({ unit: 'binary', maxLength: 300 }),
  fc.string({ unit: 'grapheme', maxLength: 100 }),
  aliasPrefixedArb,
  fullwidthArb,
);

// Feature: brain-command-router, Property 8: Normalization is idempotent and routing-invariant
describe('Property 8: Normalization is idempotent and routing-invariant', () => {
  /**
   * **Validates: Requirements 2.7**
   */
  it('normalizeMessage is idempotent', () => {
    fc.assert(
      fc.property(inputArb, (s) => {
        const once = normalizeMessage(s);
        expect(normalizeMessage(once)).toBe(once);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.7**
   */
  it('routeCommand(normalizeMessage(s)) deeply equals routeCommand(s)', () => {
    fc.assert(
      fc.property(inputArb, (s) => {
        expect(routeCommand(normalizeMessage(s))).toEqual(routeCommand(s));
      }),
      { numRuns: 200 },
    );
  });
});
