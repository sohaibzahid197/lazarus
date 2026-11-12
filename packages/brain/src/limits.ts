// SMS character limits and part-count constants.
//
// GSM-7 messages can pack 160 code units into a single SMS, but only 153
// per part when concatenated (the User Data Header eats 7 code units).
// UCS-2 (UTF-16) messages are denser per code unit — 70 for a single SMS,
// 67 per multi-part — because each character takes 16 bits instead of 7.
//
// A reply is hard-capped at 4 parts so SMS stays cheap and readable; when
// the content would exceed it the splitter truncates and appends the
// `...` indicator rather than sending a fifth part.

import type { SmsEncoding } from './encoding.js';

/**
 * Maximum code units in a single-part GSM-7 message.
 */
export const GSM_7_SINGLE_LIMIT = 160;

/**
 * Maximum code units per part in a multi-part GSM-7 message (UDH overhead).
 */
export const GSM_7_MULTI_LIMIT = 153;

/**
 * Maximum code units in a single-part UCS-2 message.
 */
export const UCS2_SINGLE_LIMIT = 70;

/**
 * Maximum code units per part in a multi-part UCS-2 message (UDH overhead).
 */
export const UCS2_MULTI_LIMIT = 67;

/**
 * Number of code units searched backward from a hard cut point while
 * looking for a space to split on, so words are not broken when a space
 * is nearby.
 */
export const WORD_BOUNDARY_WINDOW = 15;

/**
 * Hard cap on the number of SMS parts a single reply may produce.
 */
export const MAX_PARTS = 4;

/**
 * Truncation indicator appended to the final part when a reply exceeds
 * `MAX_PARTS`. Three ASCII period characters — GSM-7 safe and 3 code
 * units, which count toward the part's limit.
 */
export const TRUNCATION_INDICATOR = '...';

/**
 * The single-part and per-part code-unit limits for a given encoding.
 *
 * Used to decide whether a message fits in one SMS or must be split, and
 * to size the budget for each part once split.
 */
export interface PartLimits {
  /** Limit for a single, unsplit message. */
  single: number;
  /** Per-part limit when the message is split into multiple parts. */
  multi: number;
}

/**
 * Returns the single-part and multi-part code-unit limits for `encoding`.
 *
 * - `'GSM-7'` → `{ single: 160, multi: 153 }`
 * - `'UCS-2'` → `{ single: 70, multi: 67 }`
 *
 * @param encoding - The encoding of the message body.
 */
export function getPartLimits(encoding: SmsEncoding): PartLimits {
  switch (encoding) {
    case 'GSM-7':
      return { single: GSM_7_SINGLE_LIMIT, multi: GSM_7_MULTI_LIMIT };
    case 'UCS-2':
      return { single: UCS2_SINGLE_LIMIT, multi: UCS2_MULTI_LIMIT };
  }
}
