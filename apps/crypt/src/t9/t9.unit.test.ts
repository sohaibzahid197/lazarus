// T9 example tests for task 3.12. The HELP, 5-presses-of-2 and 201-character
// examples already live in t9.decode/t9.step/t9.encode unit tests.
import { describe, expect, it } from 'vitest';
import { decodeT9 } from './t9.decode';
import { LOWER_LETTER_MODE, type KeyEvent } from './t9.step';

describe('T9 examples', () => {
  it('3 presses of 0 show a space as the Pending_Character', () => {
    const events: KeyEvent[] = [
      { key: '0', at: 0 },
      { key: '0', at: 100 },
      { key: '0', at: 200 },
    ];
    expect(decodeT9(events, LOWER_LETTER_MODE)).toEqual({ ok: true, text: '', mode: LOWER_LETTER_MODE, pending: ' ' });
  });

  it('* in Number_Mode adds nothing and its case applies on return to Letter_Mode', () => {
    const events: KeyEvent[] = [
      { key: '#', at: 0 },
      { key: '*', at: 100 },
      { key: '2', at: 200 },
      { key: '#', at: 300 },
      { key: '2', at: 400 },
    ];
    expect(decodeT9(events, LOWER_LETTER_MODE)).toEqual({
      ok: true,
      text: '2',
      mode: { entry: 'letter', letterCase: 'upper' },
      pending: 'A',
    });
  });

  it('# then 2 2 appends 22 with no Pending_Character', () => {
    const events: KeyEvent[] = [
      { key: '#', at: 0 },
      { key: '2', at: 100 },
      { key: '2', at: 200 },
    ];
    expect(decodeT9(events, LOWER_LETTER_MODE)).toEqual({
      ok: true,
      text: '22',
      mode: { entry: 'number', letterCase: 'lower' },
      pending: null,
    });
  });
});
