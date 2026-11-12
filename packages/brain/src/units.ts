// Code-unit counting for SMS character limits.
//
// SMS capacity is measured in code units, not raw characters. In GSM-7 a
// basic character costs 1 unit while a GSM-7 extension character costs 2
// (the `ESC` escape prefix plus the character). In UCS-2 each UTF-16 code
// unit costs 1, so a supplementary character encoded as a surrogate pair
// naturally counts as 2 via `text.length`.
//
// The surrogate-predicate helpers here (`isHighSurrogate`,
// `isLowSurrogate`) let the splitter avoid cutting between a high and a
// low surrogate. They operate on UTF-16 code-unit values (`charCodeAt`),
// not code points.
import { isGsm7Basic, isGsm7Extension, type SmsEncoding } from './encoding.js';

/**
 * The GSM-7 cost of a single character in code units: `1` for a basic
 * alphabet character, `2` for an extension-table character.
 *
 * This is intended for characters already known to be GSM-7 (the GSM-7
 * counting path is only reached after `detectEncoding` confirms the whole
 * message is GSM-7). A basic character returns `1`; an extension character
 * returns `2`. Any unexpected non-GSM-7 character returns `1`.
 *
 * @param ch - A single character (one code point).
 */
export function gsm7CharWeight(ch: string): 1 | 2 {
  if (isGsm7Basic(ch)) {
    return 1;
  }
  if (isGsm7Extension(ch)) {
    return 2;
  }
  // Non-GSM-7 characters are not expected in the GSM-7 counting path
  // (it is reached only when the whole message is GSM-7). Treat any
  // unexpected character as basic cost 1 to avoid over-counting.
  return 1;
}

/**
 * Counts the SMS code units of `text` under the given `encoding`.
 *
 * - `'GSM-7'`: iterates by code point (`for...of`), summing
 *   `gsm7CharWeight` per character (1 for basic, 2 for extension). All
 *   GSM-7 characters live in the BMP as single UTF-16 code units, so
 *   `for...of` yields exactly one entry per character and no surrogate
 *   handling is needed.
 * - `'UCS-2'`: returns `text.length`, the UTF-16 code-unit count.
 *   Supplementary characters are stored as surrogate pairs, so each one
 *   already contributes 2 — no per-character weighting is required.
 *
 * @param text - The message body to measure.
 * @param encoding - The encoding determined for `text`.
 */
export function countCodeUnits(text: string, encoding: SmsEncoding): number {
  if (encoding === 'UCS-2') {
    return text.length;
  }
  let total = 0;
  for (const ch of text) {
    total += gsm7CharWeight(ch);
  }
  return total;
}

/**
 * Returns `true` when `cu` is a UTF-16 high (lead) surrogate, i.e. in the
 * range `0xD800`–`0xDBFF`. A high surrogate is always followed by a low
 * surrogate to form a supplementary character.
 *
 * @param cu - A UTF-16 code-unit value (`charCodeAt` result).
 */
export function isHighSurrogate(cu: number): boolean {
  return cu >= 0xd800 && cu <= 0xdbff;
}

/**
 * Returns `true` when `cu` is a UTF-16 low (trail) surrogate, i.e. in the
 * range `0xDC00`–`0xDFFF`. A low surrogate always follows a high surrogate
 * to form a supplementary character.
 *
 * @param cu - A UTF-16 code-unit value (`charCodeAt` result).
 */
export function isLowSurrogate(cu: number): boolean {
  return cu >= 0xdc00 && cu <= 0xdfff;
}
