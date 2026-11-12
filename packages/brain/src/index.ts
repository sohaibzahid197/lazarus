// @lazarus/brain — shared core logic for the Lazarus project.
//
// The SMS_Splitter (encoding detection, code-unit counting, limits,
// greedy splitting, truncation, prefixing) is implemented across several
// modules and exposed here through the public `splitSms` / `joinSms` API.
// This package has no dependency on React Native or Next.js: it is pure
// TypeScript consumed by both apps.
//
// The helper modules' public symbols are re-exported so consumers can
// import everything from `@lazarus/brain`.
import { detectEncoding } from './encoding.js';
import { getPartLimits } from './limits.js';
import { applyPrefixes, splitContent } from './split.js';
import { applyHardCap } from './truncation.js';
import { stripPartPrefix } from './prefix.js';
import { countCodeUnits } from './units.js';

export * from './encoding.js';
export * from './limits.js';
export * from './prefix.js';
export * from './units.js';
export {
  applyPrefixes,
  applyWordBoundary,
  findCutByBudget,
  splitContent,
} from './split.js';
export { applyHardCap } from './truncation.js';

/**
 * Splits a reply into SMS parts.
 *
 * Detects the encoding, greedily splits the text (word-boundary preferring,
 * surrogate-safe), enforces the 4-part hard cap with a `...` truncation
 * indicator, and prefixes each part with `(n/total) ` only when there is
 * more than one part. Empty input yields `['']`.
 *
 * @param replyText - The full reply text.
 * @returns The SMS parts, ready to send in order.
 */
export function splitSms(replyText: string): string[] {
  const encoding = detectEncoding(replyText);
  const content = splitContent(replyText, encoding);
  const prefixUnits = countCodeUnits('(1/4) ', encoding);
  const contentBudget = getPartLimits(encoding).multi - prefixUnits;
  const capped = applyHardCap(content, contentBudget, encoding);
  return applyPrefixes(capped);
}

/**
 * Reassembles SMS parts into the original text.
 *
 * With more than one part, each part's `(n/total) ` prefix is stripped and
 * the contents are concatenated. A single part is returned unchanged, even
 * if it begins with a prefix-shaped token. An empty array yields `''`.
 *
 * @param parts - The parts produced by `splitSms`.
 * @returns The joined text.
 */
export function joinSms(parts: string[]): string {
  if (parts.length === 0) {
    return '';
  }
  if (parts.length === 1) {
    return parts[0] as string;
  }
  return parts.map(stripPartPrefix).join('');
}
