// Text helpers for the Answer_Service: markdown stripping, SMS fit checks,
// surrogate-safe shortening and prompt-leak detection. Pure: no I/O, no clock.
// Size is always measured with the SMS_Splitter (`splitSms` / `joinSms`);
// no encoding or part-count math is duplicated here.
// _Requirements: 3.3, 3.4, 3.5, 3.6, 3.8, 11.4_
import { joinSms, splitSms } from './sms.js';
import { WORD_BOUNDARY_WINDOW } from './limits.js';
import { normalizeMessage } from './normalize.js';
import { isHighSurrogate } from './units.js';

/** Longest model text worth measuring: more than 4 x 147 GSM-7 content units. */
const PRE_CUT_UNITS = 600;

/** Window size for prompt-leak detection (Requirement 11.4). */
const LEAK_WINDOW = 40;

/** Characters after which a cut counts as a sentence end. */
const SENTENCE_ENDS: ReadonlySet<string> = new Set(['.', '!', '?', '۔', '؟']);

/**
 * Leading run of list markers (`-`, `•` or `1.`), each followed by whitespace
 * or the line end. `*` is already gone (inline markers are deleted first), so
 * stacks like `-* x` or `- - x` cannot leave a new marker behind.
 */
const LIST_MARKER = /^\s*(?:(?:[-•]|\d+\.)(?:\s+|$))+/;

/** Inline markdown markers deleted everywhere. */
const INLINE_MARKERS = /[*_#`]/g;

/**
 * Removes markdown markers and leading list markers, then normalizes
 * (NFKC, whitespace collapse, trim; lines are joined by one space).
 * NFKC runs first so full-width look-alikes are caught as markers too.
 */
export function stripMarkdown(text: string): string {
  const lines = text.normalize('NFKC').split(/\r\n|\r|\n/);
  const cleaned = lines.map((line) => line.replace(INLINE_MARKERS, '').replace(LIST_MARKER, ''));
  return normalizeMessage(cleaned.join('\n'));
}

/** True when `text` survives `splitSms` without truncation. */
export function fitsSms(text: string): boolean {
  return joinSms(splitSms(text)) === text;
}

/** Joins model text and a suffix with one space when both are non-empty. */
export function joinReply(model: string, suffix: string): string {
  if (model === '' || suffix === '') {
    return model + suffix;
  }
  return `${model} ${suffix}`;
}

/** Drops a trailing lone high surrogate so no pair is split. */
function dropTrailingHighSurrogate(text: string): string {
  if (text.length > 0 && isHighSurrogate(text.charCodeAt(text.length - 1))) {
    return text.slice(0, -1);
  }
  return text;
}

/** Index just after the last sentence end in `text`, or -1. */
function lastSentenceEnd(text: string): number {
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (SENTENCE_ENDS.has(text.charAt(i))) {
      return i + 1;
    }
  }
  return -1;
}

/** Index of the last space within the final WORD_BOUNDARY_WINDOW units, or -1. */
function lastSpaceInWindow(text: string): number {
  const index = text.lastIndexOf(' ');
  return index >= Math.max(0, text.length - WORD_BOUNDARY_WINDOW) ? index : -1;
}

/**
 * Cuts `text` to at most `limit` code units, preferring the last sentence
 * end, then the last space in the final 15 units, then the exact limit.
 * The result is a prefix of `text` with trailing whitespace trimmed and
 * never ends in a lone high surrogate. A limit at or past the end keeps
 * the whole text.
 */
export function smartCut(text: string, limit: number): string {
  if (limit >= text.length) {
    return text.trimEnd();
  }
  const slice = dropTrailingHighSurrogate(text.slice(0, Math.max(0, limit)));
  const sentenceEnd = lastSentenceEnd(slice);
  if (sentenceEnd !== -1) {
    return slice.slice(0, sentenceEnd).trimEnd();
  }
  const space = lastSpaceInWindow(slice);
  if (space !== -1) {
    return slice.slice(0, space).trimEnd();
  }
  return slice.trimEnd();
}

/**
 * Returns the longest sensible prefix of `model` such that
 * `prefix + joinReply(cut, suffix)` fits in `MAX_PARTS` SMS parts.
 * The suffix and prefix are never changed; only the model text shrinks.
 * Returns `''` if nothing of the model text fits.
 *
 * @param model - Model text, already markdown-stripped.
 * @param suffix - Fixed sentence appended after the model text (may be `''`).
 * @param prefix - Fixed text placed before the model text (default `''`).
 */
export function shortenToFit(model: string, suffix: string, prefix = ''): string {
  const fits = (cut: string): boolean => fitsSms(prefix + joinReply(cut, suffix));
  const text =
    model.length > PRE_CUT_UNITS
      ? dropTrailingHighSurrogate(model.slice(0, PRE_CUT_UNITS))
      : model;
  if (fits(text)) {
    return text;
  }
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(smartCut(text, mid))) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  let limit = lo;
  while (limit > 0 && !fits(smartCut(text, limit))) {
    limit -= 1;
  }
  const cut = smartCut(text, limit);
  return fits(cut) ? cut : '';
}

/**
 * True if `modelText` contains any 40-character window of `system`, or the
 * whole of `system` when it is shorter than 40 characters. Empty `system`
 * never leaks.
 */
export function hasPromptLeak(modelText: string, system: string): boolean {
  if (system === '') {
    return false;
  }
  if (system.length < LEAK_WINDOW) {
    return modelText.includes(system);
  }
  const windows = new Set<string>();
  for (let i = 0; i + LEAK_WINDOW <= system.length; i += 1) {
    windows.add(system.slice(i, i + LEAK_WINDOW));
  }
  for (let i = 0; i + LEAK_WINDOW <= modelText.length; i += 1) {
    if (windows.has(modelText.slice(i, i + LEAK_WINDOW))) {
      return true;
    }
  }
  return false;
}

/**
 * Removes every occurrence of `needle`, repeating until none remains, so a
 * removal cannot leave a new occurrence behind. Empty `needle` is a no-op.
 */
export function removeAll(text: string, needle: string): string {
  if (needle === '') {
    return text;
  }
  let current = text;
  while (current.includes(needle)) {
    current = current.split(needle).join('');
  }
  return current;
}
