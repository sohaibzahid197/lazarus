// Pure helpers for the T9_Keypad and the Compose_Field (Requirements 3.1–3.12, 5.4).
// The Compose_Field text is kept outside the T9State (see compose.ts): every
// step runs on a T9State whose `committed` is '' and the characters it commits
// are appended to the text, after the 480-unit check of Requirement 3.12.
import { MAX_BODY_UNITS } from '../protocol/limits';
import { KEY_MAP, isDigitKey, type DigitKey, type T9Key } from '../t9/keymap';
import { flushT9, stepT9, type KeyEvent, type LetterCase, type T9Mode, type T9State } from '../t9/t9.step';

export interface KeypadEdit {
  readonly text: string;
  readonly t9: T9State;
  /** True when a commit or Number_Mode digit was dropped by the 480-unit limit. */
  readonly dropped: boolean;
}

/** Keys in the 4 rows of 3 of Requirement 2.1, in DOM and tab order (16.1). */
export const KEYPAD_KEYS: readonly T9Key[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

function detached(t9: T9State): T9State {
  return t9.committed === '' ? t9 : { ...t9, committed: '' };
}

function appendCommitted(text: string, next: T9State): KeypadEdit {
  const added = next.committed;
  const t9 = detached(next);
  if (added === '') return { text, t9, dropped: false };
  if (text.length + added.length > MAX_BODY_UNITS) return { text, t9, dropped: true };
  return { text: text + added, t9, dropped: false };
}

/** One key press: `stepT9`, then append what it committed (Requirements 3.1–3.6, 3.12). */
export function pressKey(text: string, t9: T9State, event: KeyEvent): KeypadEdit {
  return appendCommitted(text, stepT9(detached(t9), event));
}

/** Multi_Tap_Timeout or Send: commit the Pending_Character (Requirements 3.3, 6.1). */
export function flushPending(text: string, t9: T9State): KeypadEdit {
  return appendCommitted(text, flushT9(detached(t9)));
}

/**
 * Length message of Requirement 5.4: shown after a truncation or dropped
 * character, kept until the text is shorter than 480 code units.
 */
export function nextLengthWarning(previous: boolean, text: string, limited: boolean): boolean {
  if (limited) return true;
  return previous && text.length >= MAX_BODY_UNITS;
}

/** Mode indicator of Requirement 3.7. */
export function modeIndicator(mode: T9Mode): 'abc' | 'ABC' | '123' {
  if (mode.entry === 'number') return '123';
  return mode.letterCase === 'upper' ? 'ABC' : 'abc';
}

/** Key_Map characters of a digit key without the digit itself. */
function keyChars(key: DigitKey): readonly string[] {
  return KEY_MAP[key].filter((c) => !isDigitKey(c));
}

/**
 * Visible letters on a key in the current case (Requirement 3.10). Letters are
 * space-separated and the `*` and `#` hints are words from their accessible
 * names, so the visible label is part of the accessible name of 16.3
 * (WCAG 2.5.3 Label in Name, axe rule label-content-name-mismatch).
 */
export function keyLetters(key: T9Key, letterCase: LetterCase): string {
  if (key === '*') return 'case';
  if (key === '#') return 'numbers';
  if (key === '0') return '␣';
  if (key === '1') return keyChars(key).join('');
  const chars = keyChars(key).join(' ');
  return letterCase === 'upper' ? chars.toUpperCase() : chars;
}

const PUNCTUATION_NAMES: Readonly<Record<string, string>> = {
  '.': 'period',
  ',': 'comma',
  '?': 'question mark',
  '!': 'exclamation mark',
  "'": 'apostrophe',
  '-': 'hyphen',
  ' ': 'space',
};

/** Accessible name of a key, for example `2, a b c` and `0, space` (Requirement 16.3). */
export function keyAccessibleName(key: T9Key): string {
  if (key === '*') return 'star, change case';
  if (key === '#') return 'hash, change letters or numbers';
  const names = keyChars(key).map((c) => PUNCTUATION_NAMES[c] ?? c);
  return `${key}, ${names.join(' ')}`;
}

/** Physical key to T9 key (Requirement 3.9), or null. */
export function t9KeyFromPhysical(key: string): T9Key | null {
  if (isDigitKey(key) || key === '*' || key === '#') return key;
  return null;
}

/** Key_Event press time from a DOM event `timeStamp` (design: T9 section). */
export function pressTime(timeStamp: number): number {
  return Math.max(0, Math.floor(performance.timeOrigin + timeStamp));
}
