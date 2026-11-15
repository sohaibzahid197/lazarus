import { describe, expect, it } from 'vitest';
import { decodeT9 } from './t9.decode';
import { LOWER_LETTER_MODE, type KeyEvent } from './t9.step';

describe('decodeT9', () => {
  it('returns empty text and no pending for no events', () => {
    expect(decodeT9([], LOWER_LETTER_MODE)).toEqual({ ok: true, text: '', mode: LOWER_LETTER_MODE, pending: null });
  });

  it('decodes HELP with the last letter pending (no flush)', () => {
    const events: KeyEvent[] = [
      { key: '*', at: 0 },
      { key: '4', at: 100 }, { key: '4', at: 200 },
      { key: '3', at: 300 }, { key: '3', at: 400 },
      { key: '5', at: 500 }, { key: '5', at: 600 }, { key: '5', at: 700 },
      { key: '7', at: 800 },
    ];
    const r = decodeT9(events, LOWER_LETTER_MODE);
    expect(r).toEqual({ ok: true, text: 'HEL', mode: { entry: 'letter', letterCase: 'upper' }, pending: 'P' });
  });

  it('treats equal press times as 0 ms apart', () => {
    const r = decodeT9([{ key: '2', at: 5 }, { key: '2', at: 5 }], LOWER_LETTER_MODE);
    expect(r).toEqual({ ok: true, text: '', mode: LOWER_LETTER_MODE, pending: 'b' });
  });

  it.each([
    ['decreasing', [{ key: '2', at: 10 }, { key: '2', at: 9 }]],
    ['negative', [{ key: '2', at: -1 }]],
    ['non-integer', [{ key: '2', at: 1.5 }]],
    ['unsafe', [{ key: '2', at: 2 ** 53 }]],
    ['NaN', [{ key: '2', at: Number.NaN }]],
  ] as const)('rejects %s press times with bad-time', (_name, events) => {
    expect(decodeT9(events, LOWER_LETTER_MODE)).toEqual({ ok: false, error: 'bad-time' });
  });
});
