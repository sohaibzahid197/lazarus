// Feature: crypt-ouija-simulator, Property 11: Text direction follows the first strong character
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { hasUrdu, textDirection } from './direction';

/** Characters with no strong direction: digits, spaces, punctuation. */
// Every character here is a single code point, so Array.from splits safely.
const NEUTRAL_CHARS = Array.from('0123456789 .,?!\'-()/:;\n\t');
const URDU_LETTERS = Array.from('ابپتٹثجچحخدڈذرڑزژسشصضطظعغفقکگلمنوہھءیےں');
const LATIN_LETTERS = Array.from('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');

/** A `(n/N) ` part prefix as the SMS_Splitter writes it. */
const partPrefixArb = fc
  .tuple(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 2, max: 4 }))
  .map(([n, total]) => `(${String(n)}/${String(total)}) `);

/** A prefix with no strong character. */
const neutralArb = fc
  .array(fc.oneof(fc.constantFrom(...NEUTRAL_CHARS), partPrefixArb), { maxLength: 20 })
  .map((pieces) => pieces.join(''));

const strongArb = fc.oneof(
  fc.constantFrom(...URDU_LETTERS).map((ch) => ({ ch, dir: 'rtl' as const })),
  fc.constantFrom(...LATIN_LETTERS).map((ch) => ({ ch, dir: 'ltr' as const })),
);

const tailArb = fc.string({ unit: 'binary', maxLength: 40 });

/** Reference for hasUrdu: any code point in U+0600–U+06FF. */
function referenceHasUrdu(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0600 && cp <= 0x06ff) return true;
  }
  return false;
}

describe('Text direction', () => {
  /**
   * **Validates: Requirements 5.5, 11.4, 16.7**
   */
  it('Feature: crypt-ouija-simulator, Property 11: Text direction follows the first strong character', () => {
    fc.assert(
      fc.property(neutralArb, strongArb, tailArb, (prefix, strong, tail) => {
        // First strong character decides (5.5, 11.4).
        const text = prefix + strong.ch + tail;
        expect(textDirection(text)).toBe(strong.dir);

        // No strong character gives ltr (5.5).
        expect(textDirection(prefix)).toBe('ltr');

        // hasUrdu is true exactly for a U+0600–U+06FF character (16.7).
        expect(hasUrdu(text)).toBe(referenceHasUrdu(text));
        expect(hasUrdu(prefix)).toBe(false);
        expect(hasUrdu(tail)).toBe(referenceHasUrdu(tail));
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
