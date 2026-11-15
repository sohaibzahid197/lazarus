// Feature: crypt-ouija-simulator, Property 5: T9_Encoder output follows the timing rules
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { t9TextArb } from '../test/arbitraries/t9';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { DIGIT_KEYS, KEY_MAP, type DigitKey } from './keymap';
import { MULTI_TAP_TIMEOUT_MS, type KeyEvent, type LetterCase } from './t9.step';
import { encodeT9 } from './t9.encode';

/** Key and Key_Map index of a T9_Text character, looked up straight from KEY_MAP. */
function spotOf(ch: string): { key: DigitKey; index: number } {
  const lower = ch.toLowerCase();
  for (const key of DIGIT_KEYS) {
    const index = KEY_MAP[key].indexOf(lower);
    if (index >= 0) return { key, index };
  }
  throw new Error(`not a T9_Text character: ${ch}`);
}

function letterCaseOf(ch: string): LetterCase | null {
  if (ch.toLowerCase() === ch.toUpperCase()) return null;
  return ch === ch.toLowerCase() ? 'lower' : 'upper';
}

function eventAt(events: readonly KeyEvent[], i: number): KeyEvent {
  const e = events[i];
  if (e === undefined) throw new Error(`missing event ${String(i)}`);
  return e;
}

/** Walks the text and the events together and checks every timing rule of 4.7. */
function checkTiming(text: string, events: readonly KeyEvent[]): void {
  if (events.length > 0) expect(eventAt(events, 0).at).toBe(0);
  for (let i = 1; i < events.length; i++) {
    expect(eventAt(events, i).at).toBeGreaterThanOrEqual(eventAt(events, i - 1).at);
  }

  let idx = 0;
  let current: LetterCase = 'lower';
  let prevKey: DigitKey | null = null; // previous digit key with no `*` after it
  for (const ch of text) {
    const c = letterCaseOf(ch);
    if (c !== null && c !== current) {
      expect(eventAt(events, idx).key).toBe('*'); // `*` before a case change
      current = c;
      prevKey = null;
      idx++;
    }
    const { key, index } = spotOf(ch);
    for (let p = 0; p <= index; p++) {
      const e = eventAt(events, idx);
      expect(e.key).toBe(key); // no extra `*`, no `#`
      if (idx > 0) {
        const gap = e.at - eventAt(events, idx - 1).at;
        if (p > 0) {
          expect(gap).toBeGreaterThanOrEqual(1); // presses inside one group
          expect(gap).toBeLessThan(MULTI_TAP_TIMEOUT_MS);
        } else if (prevKey === key) {
          expect(gap).toBeGreaterThanOrEqual(MULTI_TAP_TIMEOUT_MS); // same-key characters
        }
      }
      idx++;
    }
    prevKey = key;
  }
  expect(idx).toBe(events.length);
}

describe('T9_Encoder timing', () => {
  /**
   * **Validates: Requirements 4.7**
   */
  it('Feature: crypt-ouija-simulator, Property 5: T9_Encoder output follows the timing rules', () => {
    fc.assert(
      fc.property(t9TextArb, (text) => {
        const result = encodeT9(text);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        checkTiming(text, result.events);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
