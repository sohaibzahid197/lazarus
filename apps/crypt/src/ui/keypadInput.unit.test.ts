import { describe, expect, it } from 'vitest';
import type { T9Key } from '../t9/keymap';
import { INITIAL_T9_STATE, pendingOf, type T9State } from '../t9/t9.step';
import {
  KEYPAD_KEYS,
  flushPending,
  keyAccessibleName,
  keyLetters,
  modeIndicator,
  nextLengthWarning,
  pressKey,
  t9KeyFromPhysical,
} from './keypadInput';

function type(keys: readonly [T9Key, number][], start = { text: '', t9: INITIAL_T9_STATE }) {
  let s: { text: string; t9: T9State; dropped: boolean } = { ...start, dropped: false };
  for (const [key, at] of keys) s = pressKey(s.text, s.t9, { key, at });
  return s;
}

describe('keypad input helpers', () => {
  it('types HELP with a pending P, then commits it on flush', () => {
    const s = type([
      ['*', 0], ['4', 100], ['4', 200], ['3', 300], ['3', 400],
      ['5', 500], ['5', 600], ['5', 700], ['7', 800],
    ]);
    expect(s.text).toBe('HEL');
    expect(pendingOf(s.t9)).toBe('P');
    expect(s.t9.committed).toBe('');
    expect(modeIndicator(s.t9.mode)).toBe('ABC');
    expect(flushPending(s.text, s.t9).text).toBe('HELP');
  });

  it('drops a commit or digit past 480 units', () => {
    const full = 'a'.repeat(480);
    const pending = type([['2', 0]], { text: full, t9: INITIAL_T9_STATE });
    const r = flushPending(pending.text, pending.t9);
    expect(r).toMatchObject({ text: full, dropped: true });
    const num = type([['#', 0], ['5', 10]], { text: full, t9: INITIAL_T9_STATE });
    expect(num).toMatchObject({ text: full, dropped: true });
    expect(modeIndicator(num.t9.mode)).toBe('123');
  });

  it('keeps the length message until the text is under 480', () => {
    expect(nextLengthWarning(false, 'x', true)).toBe(true);
    expect(nextLengthWarning(true, 'a'.repeat(480), false)).toBe(true);
    expect(nextLengthWarning(true, 'a'.repeat(479), false)).toBe(false);
  });

  it('labels the 12 keys in row order with accessible names', () => {
    expect(KEYPAD_KEYS.join('')).toBe('123456789*0#');
    expect(keyAccessibleName('2')).toBe('2, a b c');
    expect(keyAccessibleName('0')).toBe('0, space');
    expect(keyAccessibleName('*')).toBe('star, change case');
    expect(keyAccessibleName('#')).toBe('hash, change letters or numbers');
    expect(keyLetters('7', 'lower')).toBe('p q r s');
    expect(keyLetters('7', 'upper')).toBe('P Q R S');
    expect(keyLetters('1', 'upper')).toBe(".,?!'-");
  });

  it('maps physical keys', () => {
    expect(t9KeyFromPhysical('5')).toBe('5');
    expect(t9KeyFromPhysical('#')).toBe('#');
    expect(t9KeyFromPhysical('a')).toBeNull();
  });
});
