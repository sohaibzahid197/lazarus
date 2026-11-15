// Test-only arbitraries for the T9 properties (Requirements 4.1–4.12, 18.1).
import fc from 'fast-check';
import { DIGIT_KEYS, KEY_MAP, T9_KEYS, type DigitKey, type T9Key } from '../../t9/keymap';
import { MULTI_TAP_TIMEOUT_MS, type KeyEvent, type T9Mode } from '../../t9/t9.step';

/** Most Key_Events one decoder sequence holds (4.1). */
export const MAX_ARB_EVENTS = 300;
/** Most characters one encoder input holds (4.7). */
export const MAX_ARB_T9_CHARS = 200;

/** Any starting mode: Lower or Upper Letter_Mode, or Number_Mode with a remembered case (4.1). */
export const t9ModeArb: fc.Arbitrary<T9Mode> = fc.record({
  entry: fc.constantFrom<T9Mode['entry']>('letter', 'number'),
  letterCase: fc.constantFrom<T9Mode['letterCase']>('lower', 'upper'),
});

/**
 * Gap before a press: 0 (equal times), the Multi_Tap_Timeout edges 999 and
 * 1,000, small in-group gaps, and large gaps up to a day.
 */
const gapArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.constantFrom(MULTI_TAP_TIMEOUT_MS - 1, MULTI_TAP_TIMEOUT_MS, MULTI_TAP_TIMEOUT_MS + 1),
  fc.integer({ min: 1, max: MULTI_TAP_TIMEOUT_MS - 1 }),
  fc.integer({ min: MULTI_TAP_TIMEOUT_MS, max: 86_400_000 }),
);

/**
 * A key choice. `null` repeats the previous key, so long multi-tap groups
 * (and wrap-around) are common rather than rare.
 */
function keyChoiceArb(keys: readonly T9Key[]): fc.Arbitrary<T9Key | null> {
  return fc.oneof(
    { weight: 2, arbitrary: fc.constant(null) },
    { weight: 3, arbitrary: fc.constantFrom(...keys) },
  );
}

function eventsFrom(keys: readonly T9Key[]): fc.Arbitrary<readonly KeyEvent[]> {
  const first = keys[0] ?? '0';
  return fc
    .record({
      start: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 2_000_000_000_000 })),
      steps: fc.array(fc.record({ key: keyChoiceArb(keys), gap: gapArb }), {
        minLength: 0,
        maxLength: MAX_ARB_EVENTS,
      }),
    })
    .map(({ start, steps }) => {
      const events: KeyEvent[] = [];
      let at = start;
      let prev: T9Key = first;
      steps.forEach((step, i) => {
        if (i > 0) at += step.gap;
        const key = step.key ?? prev;
        events.push({ key, at });
        prev = key;
      });
      return events;
    });
}

/** 0 to 300 Key_Events on all 12 keys with non-decreasing safe-integer times (4.10, 4.11). */
export const keyEventsArb: fc.Arbitrary<readonly KeyEvent[]> = eventsFrom(T9_KEYS);

/** 0 to 300 Key_Events on keys `0` to `9` only (4.12). */
export const digitKeyEventsArb: fc.Arbitrary<readonly KeyEvent[]> = eventsFrom(DIGIT_KEYS);

/** One bad press time: negative, not an integer, or not a number at all. */
const badTimeArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: -2_000_000_000_000, max: -1 }),
  fc.double({ min: -1e12, max: 1e12, noNaN: true }).filter((t) => !Number.isInteger(t)),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53),
);

/**
 * A valid sequence broken by exactly one bad spot (4.6): a bad press time at
 * a random index, or a decreasing pair made by inserting an earlier event.
 */
export const badTimeEventsArb: fc.Arbitrary<readonly KeyEvent[]> = fc
  .record({
    events: keyEventsArb,
    key: fc.constantFrom(...T9_KEYS),
    spot: fc.nat(),
    kind: fc.constantFrom('bad-value', 'decrease'),
    bad: badTimeArb,
    back: fc.integer({ min: 1, max: 1_000_000 }),
  })
  .map(({ events, key, spot, kind, bad, back }) => {
    const out = [...events];
    if (kind === 'bad-value' || out.length === 0) {
      out.splice(spot % (out.length + 1), 0, { key, at: bad });
      return out;
    }
    // Insert after event i an event earlier than it; negative times also count as bad.
    const i = spot % out.length;
    const at = (out[i]?.at ?? 0) - back;
    out.splice(i + 1, 0, { key, at });
    return out;
  });

/** Every T9_Text character: Key_Map characters in both cases. */
export const T9_TEXT_CHARS: readonly string[] = [
  ...new Set(DIGIT_KEYS.flatMap((k: DigitKey) => KEY_MAP[k].flatMap((c) => [c, c.toUpperCase()]))),
];

/** 0 to 200 T9_Text characters (4.7, 4.9). Same-key runs and case flips appear often. */
export const t9TextArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...T9_TEXT_CHARS), { minLength: 0, maxLength: MAX_ARB_T9_CHARS })
  .map((chars) => chars.join(''));

/** Characters that are not T9_Text: Urdu script, emoji, line breaks, tabs and other symbols (4.8). */
const nonT9CharArb: fc.Arbitrary<string> = fc.constantFrom(
  'م', 'د', 'ک', 'ے', '؟', '😀', '👻', '\n', '\r', '\t', '@', '#', '*', '+', '/', 'é', 'ß', '\u00A0',
);

/**
 * At most 200 characters with at least one non-T9 character inserted at a
 * random position of a T9_Text (4.8).
 */
export const nonT9TextArb: fc.Arbitrary<string> = fc
  .record({
    base: fc.array(fc.constantFrom(...T9_TEXT_CHARS), { minLength: 0, maxLength: MAX_ARB_T9_CHARS - 1 }),
    bad: nonT9CharArb,
    spot: fc.nat(),
  })
  .map(({ base, bad, spot }) => {
    const chars = [...base];
    chars.splice(spot % (chars.length + 1), 0, bad);
    return chars.join('');
  });
