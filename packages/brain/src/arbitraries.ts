// Shared fast-check generators (arbitraries) for the SMS_Splitter property
// tests. Each generator targets a specific region of the input space
// described in the design's testing strategy.
//
//   gsm7TextArb — strings built only from GSM-7 basic and extension chars.
//   ucs2TextArb — strings containing at least one non-GSM-7 character.
//   asciiArb    — pure printable ASCII (32–126), which may be GSM-7 or not.
//   anyTextArb  — union of the above: any text the splitter might receive.
//
// All arbitraries avoid the `any` type (Requirement 1.4). They are built from
// the exported `GSM_7_BASIC` / `GSM_7_EXTENSION` sets so a change to the
// 3GPP tables automatically flows into the generators.

import * as fc from 'fast-check';
import { GSM_7_BASIC, GSM_7_EXTENSION } from './encoding.js';

// Character pools derived from the exported GSM-7 sets.
const gsm7BasicChars: string[] = Array.from(GSM_7_BASIC);
const gsm7ExtensionChars: string[] = Array.from(GSM_7_EXTENSION);
const gsm7AllChars: string[] = [...gsm7BasicChars, ...gsm7ExtensionChars];

// A single GSM-7 character (basic or extension).
const gsm7CharArb: fc.Arbitrary<string> = fc.constantFrom(...gsm7AllChars);

// Non-GSM-7 characters that force UCS-2: Urdu letters, accented Latin
// outside the 3GPP table (e.g. â, ê — circumflex accents are not in the
// default alphabet), and supplementary-plane emoji (surrogate pairs).
const ucs2Chars: string[] = [
  'ا', 'ب', 'ک', 'م', 'ن', 'پ', 'ت', // Urdu script
  'â', 'ê', 'î', 'ô', 'û', // accented Latin not in the GSM-7 table
  '😀', '🎉', '🚀', // supplementary-plane emoji (surrogate pairs)
];
const ucs2CharArb: fc.Arbitrary<string> = fc.constantFrom(...ucs2Chars);

// Every character that may appear in a UCS-2-flavoured string: GSM-7 plus
// the non-GSM-7 characters above.
const mixedCharArb: fc.Arbitrary<string> = fc.constantFrom(
  ...gsm7AllChars,
  ...ucs2Chars,
);

/**
 * Strings built solely from GSM-7 basic and extension characters. Such
 * text is always detected as `'GSM-7'`.
 */
export const gsm7TextArb: fc.Arbitrary<string> = fc
  .array(gsm7CharArb, { maxLength: 60 })
  .map((chars: string[]) => chars.join(''));

/**
 * Strings that contain at least one non-GSM-7 character (and therefore
 * force `'UCS-2'` encoding). The required non-GSM-7 character is embedded
 * among otherwise-mixed characters so its position varies.
 */
export const ucs2TextArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(mixedCharArb, { maxLength: 30 }),
    ucs2CharArb,
    fc.array(mixedCharArb, { maxLength: 30 }),
  )
  .map(
    ([pre, required, post]: [string[], string, string[]]) =>
      pre.join('') + required + post.join(''),
  );

/**
 * Pure printable ASCII (code points 32–126). This includes the backtick
 * (`` ` ``, U+0060) which is NOT a GSM-7 character, so ASCII strings may be
 * detected as either encoding.
 */
export const asciiArb: fc.Arbitrary<string> = fc
  .array(
    fc.integer({ min: 32, max: 126 }).map((n: number) => String.fromCharCode(n)),
    { maxLength: 40 },
  )
  .map((chars: string[]) => chars.join(''));

/**
 * Any text the splitter might receive: GSM-7-only, UCS-2, or pure-ASCII.
 * Used by properties that must hold across the full input space.
 */
export const anyTextArb: fc.Arbitrary<string> = fc.oneof(
  gsm7TextArb,
  ucs2TextArb,
  asciiArb,
);
