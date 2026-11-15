// Property test for malformed stored reminders (sms-reminders task 12.3).
// **Validates: Requirements 12.7**
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gatewayState } from './gateway.arbitraries.js';
import { isCanonicalNumber } from './gateway.number.js';
import { serializeSettings } from './gateway.settings.js';
import { decodeStoredState, type DecodedState } from './gateway.state.js';
import type { GatewayState } from './gateway.types.js';
import { REMINDER_PBT_OPTIONS, reminderStore } from './reminder.arbitraries.js';
import { decodeReminders, encodeReminder } from './reminder.state.js';
import { REMINDER_TEXT_MAX } from './reminder.types.js';
import { LANGUAGES } from './router.types.js';

type Entry = Record<string, unknown>;
/** Replaces the valid encoded list with a list that has exactly one defect. */
type Corruption = (entries: readonly Entry[], index: number) => unknown[];

const KEYS = ['id', 'number', 'slot', 'dueAt', 'text', 'language', 'createdAt', 'handedAt'] as const;
const TODAY = '2025-01-15';

/** A non-empty valid store in its `loadState()` form. */
const encodedStore: fc.Arbitrary<Entry[]> = reminderStore()
  .map((s) => (s.status === 'ok' ? s.reminders.map((r) => ({ ...encodeReminder(r) })) : []))
  .filter((entries) => entries.length > 0);

/** Every value here survives `JSON.stringify` unchanged, so the defect reaches the wire. */
const nonString = fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant([]), fc.constant({}));
const nonSafeInteger = fc.oneof(
  fc.constantFrom(0.5, -1.25, 2 ** 53, -(2 ** 53), 1e300),
  fc.double({ noNaN: true, noDefaultInfinity: true }).filter((d) => !Number.isSafeInteger(d)),
  fc.string({ maxLength: 5 }),
  fc.boolean(),
  fc.constant([]),
  fc.constant({}),
);
const badTime = fc.oneof(nonSafeInteger, fc.constant(null));
const badSlot = fc.oneof(
  fc.integer().filter((n) => n < 1 || n > 5),
  fc.constantFrom(1.5, 4.999, '1', '5', null, true),
);
const badText = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: REMINDER_TEXT_MAX + 1, maxLength: REMINDER_TEXT_MAX + 40 }),
  // 71 emoji outside the BMP: 71 code points but 142 UTF-16 code units.
  fc.constant('😀'.repeat(71)),
  nonString,
);
const badLanguage = fc.oneof(
  fc.string({ maxLength: 10 }).filter((s) => !(LANGUAGES as readonly string[]).includes(s)),
  fc.constantFrom('EN', 'urdu', 'roman_ur', 'roman-UR'),
  nonString,
);
const badNumber = fc.oneof(
  fc.string({ maxLength: 20 }).filter((s) => !isCanonicalNumber(s)),
  fc.constantFrom('923001234567', '+0923001234567', '+92 300 1234567', '+92300', '+1234567890123456', '+92300123456a'),
  nonString,
);
const notObject = fc.oneof(nonString.filter((v) => !(typeof v === 'object' && v !== null && !Array.isArray(v))), fc.string());
const extraKey = fc.string({ minLength: 1, maxLength: 8 }).filter((k) => !(KEYS as readonly string[]).includes(k));

const withField =
  (key: (typeof KEYS)[number], value: unknown): Corruption =>
  (entries, i) =>
    entries.map((e, j) => (j === i ? { ...e, [key]: value } : e));

/** One defect of each kind listed in Requirement 12.7 and the task. */
const corruption: fc.Arbitrary<{ readonly kind: string; readonly apply: Corruption }> = fc.oneof(
  notObject.map((v) => ({ kind: 'not-object', apply: (es: readonly Entry[], i: number) => es.map((e, j) => (j === i ? v : e)) })),
  fc.constantFrom(...KEYS).map((key) => ({
    kind: 'missing-key',
    apply: (es: readonly Entry[], i: number) =>
      es.map((e, j) => (j === i ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e)),
  })),
  fc.tuple(extraKey, fc.jsonValue()).map(([k, v]) => ({ kind: 'extra-key', apply: withField(k as (typeof KEYS)[number], v) })),
  nonString.map((v) => ({ kind: 'id', apply: withField('id', v) })),
  badNumber.map((v) => ({ kind: 'number', apply: withField('number', v) })),
  badSlot.map((v) => ({ kind: 'slot', apply: withField('slot', v) })),
  badText.map((v) => ({ kind: 'text', apply: withField('text', v) })),
  badLanguage.map((v) => ({ kind: 'language', apply: withField('language', v) })),
  badTime.map((v) => ({ kind: 'dueAt', apply: withField('dueAt', v) })),
  badTime.map((v) => ({ kind: 'createdAt', apply: withField('createdAt', v) })),
  nonSafeInteger.map((v) => ({ kind: 'handedAt', apply: withField('handedAt', v) })),
  fc.nat().map((pos) => ({
    kind: 'duplicate-slot',
    apply: (es: readonly Entry[], i: number) => {
      const copy = { ...es[i], id: `dup:${String(i)}` };
      const out: unknown[] = [...es];
      out.splice(pos % (es.length + 1), 0, copy);
      return out;
    },
  })),
);

/** The `loadState()` JSON for a state, with `reminders` replaced by `reminders`. */
function payload(state: GatewayState, reminders: unknown, paused: boolean): string {
  return JSON.stringify({
    stopList: [...state.stopList],
    allowlist: state.allowlist === 'unreadable' ? null : [...state.allowlist],
    rate: [...state.rate.entries()],
    slowDown: [...state.slowDown.entries()],
    counters: state.counters,
    settings: serializeSettings(state.settings),
    paused,
    reminders,
  });
}

function okOf(r: DecodedState): Extract<DecodedState, { status: 'ok' }> {
  if (r.status !== 'ok') throw new Error('expected the state to decode');
  return r;
}

describe('reminder.state decodeReminders', () => {
  // Feature: sms-reminders, Property 34: Malformed stored reminders make the store unreadable
  it('12.7 any malformed stored reminder, null or missing value makes the store unreadable, never empty', () => {
    // One defect in an otherwise valid store gives unreadable.
    fc.assert(
      fc.property(encodedStore, fc.nat(), corruption, (entries, n, c) => {
        const corrupted = c.apply(entries, n % entries.length);
        expect(decodeReminders(entries).status).toBe('ok');
        expect(decodeReminders(corrupted)).toEqual({ status: 'unreadable' });
      }),
      REMINDER_PBT_OPTIONS,
    );

    // null, missing and non-array values give unreadable.
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(null), fc.constant(undefined), fc.jsonValue().filter((v) => !Array.isArray(v))),
        (value) => {
          expect(decodeReminders(value)).toEqual({ status: 'unreadable' });
        },
      ),
      REMINDER_PBT_OPTIONS,
    );

    // Arbitrary values never throw and give one of the two documented results.
    fc.assert(
      fc.property(fc.oneof(fc.jsonValue(), fc.array(fc.jsonValue()), fc.anything()), (value) => {
        const r = decodeReminders(value);
        expect(['ok', 'unreadable']).toContain(r.status);
      }),
      REMINDER_PBT_OPTIONS,
    );

    // In decodeStoredState a bad `reminders` key keeps the rest of the state.
    fc.assert(
      fc.property(gatewayState(), fc.boolean(), encodedStore, fc.nat(), corruption, (state, paused, entries, n, c) => {
        const good = okOf(decodeStoredState(payload(state, entries, paused), TODAY));
        const bad = okOf(decodeStoredState(payload(state, c.apply(entries, n % entries.length), paused), TODAY));
        const missing = okOf(
          decodeStoredState(JSON.stringify({ ...(JSON.parse(payload(state, null, paused)) as Entry), reminders: undefined }), TODAY),
        );
        expect(good.state.reminders.status).toBe('ok');
        for (const r of [bad, missing]) {
          expect(r.state.reminders).toEqual({ status: 'unreadable' });
          const { reminders: _a, ...rest } = r.state;
          const { reminders: _b, ...goodRest } = good.state;
          expect(rest).toEqual(goodRest);
          expect(r.paused).toBe(good.paused);
          expect(r.settingsStatus).toBe(good.settingsStatus);
        }
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
