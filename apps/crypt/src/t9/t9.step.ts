// One pure multi-tap step (design C1). The T9_Decoder folds it, and the
// Phone_Mock calls it on every key press, so both always agree.

import { KEY_MAP, isDigitKey, type DigitKey, type T9Key } from './keymap';

export interface KeyEvent {
  readonly key: T9Key;
  readonly at: number;
}

export type LetterCase = 'lower' | 'upper';

export interface T9Mode {
  readonly entry: 'letter' | 'number';
  readonly letterCase: LetterCase;
}

export interface T9Group {
  readonly key: DigitKey;
  readonly presses: number;
  readonly lastAt: number;
}

export interface T9State {
  readonly committed: string;
  readonly mode: T9Mode;
  /** Open Letter_Mode group, the source of the Pending_Character. */
  readonly group: T9Group | null;
  /** Time of the previous Key_Event. */
  readonly lastAt: number | null;
  readonly lastKey: T9Key | null;
}

export const MULTI_TAP_TIMEOUT_MS = 1_000;

export const LOWER_LETTER_MODE: T9Mode = { entry: 'letter', letterCase: 'lower' };

export function initialT9State(mode: T9Mode = LOWER_LETTER_MODE): T9State {
  return { committed: '', mode, group: null, lastAt: null, lastKey: null };
}

/** Lower_Case Letter_Mode, empty, no Pending_Character (Requirement 3.11). */
export const INITIAL_T9_STATE: T9State = initialT9State();

/** Character of a group: KEY_MAP[key][(presses − 1) mod len], case applied to letters only. */
export function charOf(g: T9Group, c: LetterCase): string {
  const chars = KEY_MAP[g.key];
  const ch = chars[(g.presses - 1) % chars.length] ?? '';
  return c === 'upper' ? ch.toUpperCase() : ch;
}

export function pendingOf(s: T9State): string | null {
  return s.group === null ? null : charOf(s.group, s.mode.letterCase);
}

/** Commit the open group, if any. Used by the Multi_Tap_Timeout and by `*`, `#`. */
export function flushT9(s: T9State): T9State {
  if (s.group === null) return s;
  return { ...s, committed: s.committed + charOf(s.group, s.mode.letterCase), group: null };
}

/** Apply one Key_Event. Assumes `e.at ≥ s.lastAt`; the decoder checks times. */
export function stepT9(s: T9State, e: KeyEvent): T9State {
  const base = { lastAt: e.at, lastKey: e.key };
  // Rule 1: `*` commits, then flips the case. Entry mode unchanged.
  if (e.key === '*') {
    const f = flushT9(s);
    const letterCase: LetterCase = f.mode.letterCase === 'lower' ? 'upper' : 'lower';
    return { ...f, ...base, mode: { ...f.mode, letterCase } };
  }
  // Rule 2: `#` commits, then flips Letter_Mode / Number_Mode. Case unchanged.
  if (e.key === '#') {
    const f = flushT9(s);
    const entry = f.mode.entry === 'letter' ? 'number' : 'letter';
    return { ...f, ...base, mode: { ...f.mode, entry } };
  }
  if (!isDigitKey(e.key)) return s;
  // Rule 3: Number_Mode appends the digit at once.
  if (s.mode.entry === 'number') {
    return { ...s, ...base, committed: s.committed + e.key };
  }
  // Rule 4: same key within the Multi_Tap_Timeout extends the open group.
  const g = s.group;
  if (g !== null && g.key === e.key && e.at - g.lastAt < MULTI_TAP_TIMEOUT_MS) {
    return { ...s, ...base, group: { key: g.key, presses: g.presses + 1, lastAt: e.at } };
  }
  // Rule 5: otherwise commit the open group and open a new one.
  const f = flushT9(s);
  return { ...f, ...base, group: { key: e.key, presses: 1, lastAt: e.at } };
}
