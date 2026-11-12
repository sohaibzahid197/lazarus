// Part prefix formatting and stripping for multi-part SMS messages.
//
// When a reply is split into more than one SMS part, each part is prefixed
// with a counter of the form `(n/total) ` — for example `(1/3) ` — so the
// receiver can reassemble and order the parts. The prefix counts toward
// each part's character limit (handled by the splitter, not here).
//
// Because of the 4-part hard cap, `n` and `total` are always single digits,
// so the prefix is always 6 code units. The functions here are
// encoding-agnostic: they operate on plain strings and do not need the
// `SmsEncoding` tag.

/**
 * Regular expression matching a leading part prefix `(n/total) ` at the
 * start of a string. `n` and `total` are one or more digits, followed by a
 * single trailing space.
 */
export const PART_PREFIX_PATTERN: RegExp = /^\(\d+\/\d+\) /;

/**
 * Formats the part prefix for the `n`-th part (1-indexed) of `total` parts.
 *
 * Returns the string `(n/total) ` including the trailing space. Example:
 * `formatPartPrefix(1, 2)` → `"(1/2) "`.
 *
 * @param n - The 1-indexed part number.
 * @param total - The total number of parts.
 */
export function formatPartPrefix(n: number, total: number): string {
  return `(${n}/${total}) `;
}

/**
 * Removes a single leading part prefix `(n/total) ` from `part` if one is
 * present. Returns `part` unchanged when no prefix matches, so the function
 * is safe to call on parts that were never prefixed (e.g. a lone single
 * part).
 *
 * @param part - A possibly-prefixed SMS part string.
 */
export function stripPartPrefix(part: string): string {
  const match = part.match(PART_PREFIX_PATTERN);
  if (match === null) {
    return part;
  }
  return part.slice(match[0].length);
}
