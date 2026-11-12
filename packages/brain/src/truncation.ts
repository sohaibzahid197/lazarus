// Hard-cap truncation for SMS replies.
//
// A reply is capped at MAX_PARTS parts. When the greedy splitter produces
// more, the first MAX_PARTS - 1 parts are kept as-is and every remaining
// part is rejoined, trimmed to fit the last part's budget (leaving room
// for the `...` indicator), and suffixed with the indicator.

import type { SmsEncoding } from './encoding.js';
import { MAX_PARTS, TRUNCATION_INDICATOR } from './limits.js';
import { applyWordBoundary, findCutByBudget } from './split.js';

/**
 * Enforces the `MAX_PARTS` cap on unprefixed content parts.
 *
 * If `parts.length <= MAX_PARTS` the input is returned unchanged. Otherwise
 * the first `MAX_PARTS - 1` parts are kept, the rest are rejoined, and the
 * rejoined text is cut to `contentBudget - TRUNCATION_INDICATOR.length`
 * code units (surrogate-safe, preferring a word boundary). The final part
 * is that cut text followed by `TRUNCATION_INDICATOR`, so the result always
 * has exactly `MAX_PARTS` parts and the last one fits `contentBudget`.
 *
 * @param parts - Unprefixed content parts from `splitContent`.
 * @param contentBudget - Per-part content budget (multi-part limit minus
 *   prefix units).
 * @param encoding - The encoding of the message body.
 * @returns At most `MAX_PARTS` content parts.
 */
export function applyHardCap(
  parts: string[],
  contentBudget: number,
  encoding: SmsEncoding,
): string[] {
  if (parts.length <= MAX_PARTS) {
    return parts;
  }

  const kept = parts.slice(0, MAX_PARTS - 1);
  const rest = parts.slice(MAX_PARTS - 1).join('');
  const truncBudget = contentBudget - TRUNCATION_INDICATOR.length;
  const hardCut = findCutByBudget(rest, truncBudget, encoding);
  const cut = applyWordBoundary(rest, hardCut);

  return [...kept, rest.slice(0, cut) + TRUNCATION_INDICATOR];
}
