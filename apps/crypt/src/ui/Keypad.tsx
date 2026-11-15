'use client';
// T9_Keypad (Requirements 3.9, 3.10, 16.3). Presentational: the parent runs
// `pressKey` on each press and owns the Multi_Tap_Timeout timer. Clear and
// Send buttons live in PhoneMock; physical Backspace and Enter on a focused
// key call `onClear` and `onSend` here (3.9). Styles come from globals.css.
import type { KeyboardEvent } from 'react';
import type { T9Key } from '../t9/keymap';
import type { LetterCase } from '../t9/t9.step';
import { KEYPAD_KEYS, keyAccessibleName, keyLetters, pressTime, t9KeyFromPhysical } from './keypadInput';

export interface KeypadProps {
  readonly letterCase: LetterCase;
  /** One Key_Event; `at` is the press time in ms. */
  readonly onKey: (key: T9Key, at: number) => void;
  readonly onClear: () => void;
  readonly onSend: () => void;
}

export function Keypad({ letterCase, onKey, onClear, onSend }: KeypadProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = t9KeyFromPhysical(e.key);
    if (key !== null) {
      e.preventDefault();
      if (!e.repeat) onKey(key, pressTime(e.timeStamp));
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      onClear();
    } else if (e.key === 'Enter') {
      // Stops the focused key from also being clicked by Enter.
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="keypad" role="group" aria-label="Keypad" onKeyDown={handleKeyDown}>
      {KEYPAD_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className="keypad__key"
          aria-label={keyAccessibleName(key)}
          onClick={(e) => {
            onKey(key, pressTime(e.timeStamp));
          }}
        >
          <span className="keypad__digit" aria-hidden="true">
            {key}
          </span>{' '}
          <span className="keypad__letters" aria-hidden="true">
            {keyLetters(key, letterCase)}
          </span>
        </button>
      ))}
    </div>
  );
}
