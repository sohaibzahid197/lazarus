import { describe, expect, it } from 'vitest';
import { decodeT9 } from './t9.decode';
import { encodeT9 } from './t9.encode';
import { LOWER_LETTER_MODE } from './t9.step';

function roundTrip(text: string): string | null {
  const enc = encodeT9(text);
  if (!enc.ok) return null;
  const dec = decodeT9(enc.events, LOWER_LETTER_MODE);
  return dec.ok ? dec.text + (dec.pending ?? '') : null;
}

describe('encodeT9', () => {
  it('encodes HELP with a leading star at time 0', () => {
    const r = encodeT9('HELP');
    expect(r).toEqual({
      ok: true,
      events: [
        { key: '*', at: 0 },
        { key: '4', at: 100 }, { key: '4', at: 200 },
        { key: '3', at: 300 }, { key: '3', at: 400 },
        { key: '5', at: 500 }, { key: '5', at: 600 }, { key: '5', at: 700 },
        { key: '7', at: 800 },
      ],
    });
  });

  it('separates consecutive characters on the same key by at least 1,000 ms', () => {
    const r = encodeT9('ab');
    expect(r).toEqual({ ok: true, events: [{ key: '2', at: 0 }, { key: '2', at: 1_100 }, { key: '2', at: 1_200 }] });
  });

  it.each(['', 'HELP', 'hello world', 'aaa', 'Aa', 'Kya aaj barish hogi?', "it's 2 o'clock - ok!", 'zz99 00', 'a'.repeat(200)])(
    'round-trips %j through decodeT9',
    (text) => {
      expect(roundTrip(text)).toBe(text);
    },
  );

  it('rejects text over 200 characters as too-long', () => {
    expect(encodeT9('a'.repeat(201))).toEqual({ ok: false, error: 'too-long' });
  });

  it.each(['مدد', 'hi 👋', 'a\nb', 'a@b'])('rejects non-T9 text %j', (text) => {
    expect(encodeT9(text)).toEqual({ ok: false, error: 'not-t9-text' });
  });
});
