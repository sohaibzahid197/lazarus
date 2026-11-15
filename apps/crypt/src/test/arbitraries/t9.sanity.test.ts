// Sanity checks for the T9 arbitraries and the reference decoder: generated
// values meet their contract and cover the edge cases the properties need.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isDigitKey, isT9Text } from '../../t9/keymap';
import { LOWER_LETTER_MODE, type KeyEvent } from '../../t9/t9.step';
import { CRYPT_PBT_OPTIONS } from '../pbt';
import { referenceDecodeT9 } from '../t9.reference';
import {
  MAX_ARB_EVENTS,
  MAX_ARB_T9_CHARS,
  badTimeEventsArb,
  digitKeyEventsArb,
  keyEventsArb,
  nonT9TextArb,
  t9TextArb,
} from './t9';

function validTimes(events: readonly KeyEvent[]): boolean {
  let prev = 0;
  return events.every((e) => {
    const ok = Number.isSafeInteger(e.at) && e.at >= prev;
    prev = e.at;
    return ok;
  });
}

const gaps = (es: readonly KeyEvent[]) => es.slice(1).map((e, i) => e.at - (es[i]?.at ?? e.at));

describe('T9 arbitraries', () => {
  it('keyEventsArb gives 0 to 300 events with non-decreasing safe-integer times', () => {
    fc.assert(
      fc.property(keyEventsArb, (events) => {
        expect(events.length).toBeLessThanOrEqual(MAX_ARB_EVENTS);
        expect(validTimes(events)).toBe(true);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });

  it('keyEventsArb hits gaps of 0, 999, 1,000 and large values, and `*`/`#`', () => {
    const samples = fc.sample(keyEventsArb, { numRuns: 200, seed: 42 });
    const all = samples.flatMap(gaps);
    for (const g of [0, 999, 1_000]) expect(all).toContain(g);
    expect(all.some((g) => g > 60_000)).toBe(true);
    expect(samples.some((es) => es.some((e) => e.key === '*'))).toBe(true);
    expect(samples.some((es) => es.some((e) => e.key === '#'))).toBe(true);
  });

  it('digitKeyEventsArb uses only keys 0 to 9', () => {
    fc.assert(
      fc.property(digitKeyEventsArb, (events) => {
        expect(events.every((e) => isDigitKey(e.key))).toBe(true);
        expect(validTimes(events)).toBe(true);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });

  it('badTimeEventsArb always holds a bad or decreasing press time', () => {
    fc.assert(
      fc.property(badTimeEventsArb, (events) => {
        expect(validTimes(events)).toBe(false);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });

  it('t9TextArb gives 0 to 200 T9_Text characters', () => {
    fc.assert(
      fc.property(t9TextArb, (text) => {
        expect(Array.from(text).length).toBeLessThanOrEqual(MAX_ARB_T9_CHARS);
        expect(isT9Text(text)).toBe(true);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });

  it('nonT9TextArb gives at most 200 characters with a non-T9 character', () => {
    fc.assert(
      fc.property(nonT9TextArb, (text) => {
        expect(Array.from(text).length).toBeLessThanOrEqual(MAX_ARB_T9_CHARS);
        expect(isT9Text(text)).toBe(false);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});

describe('reference T9 decoder', () => {
  const ev = (spec: string): KeyEvent[] =>
    spec.split(' ').map((p) => {
      const [key, at] = p.split('@');
      return { key: key as KeyEvent['key'], at: Number(at) };
    });

  it('decodes `*` then HELP as HEL plus pending P, with 4 groups', () => {
    const r = referenceDecodeT9(
      ev('*@0 4@100 4@200 3@300 3@400 5@500 5@600 5@700 7@800'),
      LOWER_LETTER_MODE,
    );
    expect(r).toEqual({ text: 'HEL', mode: { entry: 'letter', letterCase: 'upper' }, pending: 'P', groups: 4 });
  });

  it('wraps, splits groups at 1,000 ms and appends digits in Number_Mode', () => {
    expect(referenceDecodeT9(ev('2@0 2@1 2@2 2@3 2@4'), LOWER_LETTER_MODE).pending).toBe('a');
    expect(referenceDecodeT9(ev('2@0 2@999 2@1999'), LOWER_LETTER_MODE)).toMatchObject({ text: 'b', pending: 'a' });
    expect(referenceDecodeT9(ev('#@0 2@1 2@2'), LOWER_LETTER_MODE)).toMatchObject({ text: '22', pending: null, groups: 0 });
  });
});
