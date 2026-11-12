// Greedy SMS splitting with word-boundary preference and surrogate-safe
// cuts.
//
// This module contains the core splitting helpers used by the public
// `splitSms` entry point:
//   findCutByBudget   — largest code-unit prefix that fits a budget, never
//                       splitting a UTF-16 surrogate pair.
//   applyWordBoundary — prefer to split after a space within the last
//                       WORD_BOUNDARY_WINDOW code units.
//   splitContent      — greedily fill unprefixed content parts.
//   applyPrefixes     — prepend `(n/total) ` only when more than one part.
//
// The functions are pure and encoding-aware. Word-boundary splits keep the
// space in the current part (splitting *after* the space), so no character
// is ever dropped and `joinSms(splitSms(t)) === t` for non-truncated input.

import type { SmsEncoding } from './encoding.js';
import { countCodeUnits, gsm7CharWeight, isHighSurrogate } from './units.js';
import { WORD_BOUNDARY_WINDOW, getPartLimits } from './limits.js';
import { formatPartPrefix } from './prefix.js';

/**
 * The largest code-unit prefix of `text` whose total cost fits within
 * `budget`, chosen so that a UTF-16 surrogate pair is never split across
 * the cut.
 *
 * - `'UCS-2'`: `cut = min(text.length, budget)`. If the cut would land
 *   immediately after a high (lead) surrogate — i.e. `cut < text.length`
 *   and `text.charCodeAt(cut - 1)` is a high surrogate — decrement `cut` by
 *   1 so the surrogate pair stays together in the *next* part.
 * - `'GSM-7'`: walk the characters, accumulating `gsm7CharWeight` (1 for a
 *   basic character, 2 for an extension character); stop when the next
 *   character would push the running total over `budget`. The returned
 *   `cut` is the number of code units taken, which equals the number of
 *   characters taken because every GSM-7 character is a single BMP code
 *   unit.
 *
 * @param text - The message body (or remaining slice) to measure.
 * @param budget - The maximum code units the prefix may consume.
 * @param encoding - The encoding of `text`.
 * @returns A code-unit count `cut` such that `text.slice(0, cut)` fits the
 *   budget without splitting a surrogate pair. May be `0` when the budget
 *   is too small for even one character.
 */
export function findCutByBudget(
  text: string,
  budget: number,
  encoding: SmsEncoding,
): number {
  if (encoding === 'UCS-2') {
    let cut = Math.min(text.length, budget);
    // Avoid leaving a lone high surrogate at the end of this part: if the
    // cut falls right after a high surrogate, move the whole pair into the
    // next part.
    if (cut < text.length && isHighSurrogate(text.charCodeAt(cut - 1))) {
      cut -= 1;
    }
    return cut;
  }

  // GSM-7: every character is a single BMP code unit, so character index
  // and code-unit index coincide. Accumulate the weighted cost and stop
  // before exceeding the budget.
  let units = 0;
  let cut = 0;
  for (const ch of text) {
    const weight = gsm7CharWeight(ch);
    if (units + weight > budget) {
      break;
    }
    units += weight;
    cut += 1;
  }
  return cut;
}

/**
 * Adjusts a hard cut point to fall after the latest space within the last
 * `WORD_BOUNDARY_WINDOW` code units, so words are not broken when a space
 * is nearby.
 *
 * Scans backward from index `hardCut - 1` down to
 * `max(0, hardCut - WORD_BOUNDARY_WINDOW)` for a space (`0x20`). If found
 * at index `s`, returns `s + 1` — the split happens *after* the space, so
 * the space stays in the current part and no character is dropped. If no
 * space is found, returns `hardCut` unchanged. A space is never part of a
 * surrogate pair, so the adjusted cut is always surrogate-safe.
 *
 * @param text - The message body (or remaining slice) being split.
 * @param hardCut - The code-unit cut proposed by `findCutByBudget`.
 * @returns The adjusted code-unit cut, either `hardCut` or the position
 *   just after the latest space in the window.
 */
export function applyWordBoundary(text: string, hardCut: number): number {
  const lower = Math.max(0, hardCut - WORD_BOUNDARY_WINDOW);
  for (let i = hardCut - 1; i >= lower; i--) {
    if (text.charCodeAt(i) === 0x20) {
      return i + 1;
    }
  }
  return hardCut;
}

/**
 * Greedily splits `text` into unprefixed content parts, each within the
 * per-part content budget, preferring word boundaries and never splitting
 * a surrogate pair.
 *
 * If the whole text fits within the single-part limit, it is returned as a
 * single-element array. Otherwise each part is filled up to
 * `contentBudget = multiLimit - prefixUnits`, where `prefixUnits` is the
 * code-unit cost of the `(1/4) ` part prefix (6 under the 4-part cap). The
 * returned parts carry no prefix; prefixing is applied separately by
 * `applyPrefixes`.
 *
 * A degenerate budget that yields a zero-length cut is forced to `1` to
 * guarantee forward progress and avoid an infinite loop. Under the real
 * limits this path is unreachable.
 *
 * @param text - The message body to split.
 * @param encoding - The encoding of `text`.
 * @returns An array of unprefixed content strings.
 */
export function splitContent(text: string, encoding: SmsEncoding): string[] {
  const { single, multi } = getPartLimits(encoding);
  const total = countCodeUnits(text, encoding);
  if (total <= single) {
    return [text];
  }

  const prefixUnits = countCodeUnits('(1/4) ', encoding);
  const contentBudget = multi - prefixUnits;

  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let hardCut = findCutByBudget(remaining, contentBudget, encoding);
    // Guard against a degenerate budget that cannot hold even one unit:
    // force forward progress so the loop always terminates.
    if (hardCut < 1) {
      hardCut = 1;
    }
    // The final chunk already fits: keep it whole rather than cutting after
    // a nearby space, which would create a needless extra tail part.
    const cut =
      hardCut >= remaining.length
        ? hardCut
        : applyWordBoundary(remaining, hardCut);
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  return parts;
}

/**
 * Prepends a `(n/total) ` part prefix to each part, but only when there is
 * more than one part. A single part is returned unchanged (no prefix).
 *
 * @param parts - The content parts produced by `splitContent` (after any
 *   hard-cap truncation).
 * @returns The parts with prefixes applied, or the input unchanged when it
 *   is a single part.
 */
export function applyPrefixes(parts: string[]): string[] {
  if (parts.length === 1) {
    return parts;
  }
  return parts.map(
    (part, index) => formatPartPrefix(index + 1, parts.length) + part,
  );
}
