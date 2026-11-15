// Test-only arbitraries for the Session_Snapshot properties (Requirements 8.2–8.4, 8.8, 18.1).
import fc from 'fast-check';
import {
  LANGUAGES,
  REMINDER_HORIZON_MS,
  REMINDER_LIMIT,
  REMINDER_TEXT_MAX,
  localDayKey,
  type Language,
} from '@lazarus/brain';
import { PK_OFFSET_MINUTES } from '../../protocol/emptySnapshot';
import type { SessionSnapshot, SnapshotCounters, SnapshotReminder } from '../../protocol/snapshot.types';
import type { SnapshotError } from '../../server/snapshot.parse';

/** Most receive times a valid Session_Snapshot holds (8.1). */
export const MAX_ARB_TIMES = 120;
/** Largest valid day count (8.1). */
export const MAX_ARB_COUNT = 1_000_000;
/** Longest valid Reminder_Id (8.1). */
export const MAX_ARB_ID = 64;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** 2100-01-01T00:00:00Z; far enough ahead, and every derived time stays a safe integer. */
const MAX_SERVER_TIME = 4_102_444_800_000;

type Slot = SnapshotReminder['slot'];
type Json = Readonly<Record<string, unknown>>;

const SLOTS: readonly Slot[] = [1, 2, 3, 4, 5];
const TOP_KEYS = ['stopped', 'receiveTimes', 'slowDownAt', 'counters', 'reminders'] as const;
const COUNT_KEYS = ['received', 'repliesSent', 'replied', 'partsSent', 'ignored', 'handed'] as const;
const COUNTER_KEYS = ['dayKey', ...COUNT_KEYS] as const;
const REMINDER_KEYS = ['id', 'slot', 'dueAt', 'text', 'language', 'createdAt'] as const;

/**
 * A Server_Time of at least 1 ms (so a time before it exists): any time up to
 * 2100, the design example time, and times around 2026.
 */
export const serverTimeArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: 1, max: MAX_SERVER_TIME }),
  fc.constant(1_767_225_600_000),
  fc.integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 }),
);

/** A time in [min, max]; callers guarantee min ≤ max. */
function timeIn(min: number, max: number): fc.Arbitrary<number> {
  return fc.integer({ min, max });
}

/** A time not later than `serverTime`, often inside the last hour or day, sometimes exactly it. */
function pastTimeArb(serverTime: number): fc.Arbitrary<number> {
  return fc.oneof(
    timeIn(Math.max(0, serverTime - HOUR_MS), serverTime),
    timeIn(Math.max(0, serverTime - DAY_MS), serverTime),
    timeIn(0, serverTime),
    fc.constant(serverTime),
  );
}

function sorted(times: readonly number[]): number[] {
  return [...times].sort((a, b) => a - b);
}

/** 0 to `max` non-decreasing receive times, short lists and lists near the 120 cap. */
function receiveTimesArb(serverTime: number, max = MAX_ARB_TIMES): fc.Arbitrary<readonly number[]> {
  const time = pastTimeArb(serverTime);
  return fc
    .oneof(
      { weight: 4, arbitrary: fc.array(time, { maxLength: Math.min(10, max) }) },
      { weight: 1, arbitrary: fc.array(time, { minLength: Math.max(0, max - 20), maxLength: max }) },
    )
    .map(sorted);
}

/** A day key for today in Pakistan_Time, or for another day (counters left from an earlier day). */
function dayKeyArb(serverTime: number): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant(localDayKey(serverTime, PK_OFFSET_MINUTES)),
    timeIn(0, serverTime + REMINDER_HORIZON_MS).map((t) => localDayKey(t, PK_OFFSET_MINUTES)),
  );
}

/** A day count: 0, small, near the Daily_Send_Cap of 200, anything, or the 1,000,000 cap. */
const countArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 0, max: 10 }),
  fc.integer({ min: 190, max: 210 }),
  fc.integer({ min: 0, max: MAX_ARB_COUNT }),
  fc.constant(MAX_ARB_COUNT),
);

function countersArb(serverTime: number): fc.Arbitrary<SnapshotCounters> {
  return fc.record({
    dayKey: dayKeyArb(serverTime),
    received: countArb,
    repliesSent: countArb,
    replied: countArb,
    partsSent: countArb,
    ignored: countArb,
    handed: countArb,
  });
}

/** A Reminder_Id of 1 to 64 characters: brain-style `r:m…-…` ids or any ASCII string. */
const reminderIdArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(fc.stringMatching(/^[a-z]{1,12}$/), fc.stringMatching(/^[a-z]{1,3}$/))
    .map(([a, b]) => `r:m${a}-${b}`),
  fc.string({ minLength: 1, maxLength: MAX_ARB_ID }),
);

// Single BMP code points, so splitting by code unit is safe here.
const URDU_CHARS = 'آابپتٹثجچحخدڈذرڑزژسشصضطظعغفقکگلمنوہھءیے ؟۔'.split('');
const PHONEISH_CHARS = '0123456789 +-'.split('');

/** A Reminder_Text of 1 to 140 UTF-16 code units: ASCII, Urdu, digit runs or any code points. */
const reminderTextArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 1, maxLength: REMINDER_TEXT_MAX }),
  fc.string({ unit: fc.constantFrom(...URDU_CHARS), minLength: 1, maxLength: REMINDER_TEXT_MAX }),
  fc.string({ unit: fc.constantFrom(...PHONEISH_CHARS), minLength: 1, maxLength: REMINDER_TEXT_MAX }),
  // A code point takes at most 2 code units, so 70 code points fit in 140 units.
  fc.string({ unit: 'binary', minLength: 1, maxLength: REMINDER_TEXT_MAX / 2 }),
);

const languageArb: fc.Arbitrary<Language> = fc.constantFrom(...LANGUAGES);

type ReminderBody = Omit<SnapshotReminder, 'id' | 'slot'>;

/**
 * The time and text fields of one valid Reminder: Due_Time past due (8.8),
 * ahead, or exactly at the Reminder_Horizon; creation time not after the Due_Time
 * nor the Server_Time.
 */
function reminderBodyArb(serverTime: number): fc.Arbitrary<ReminderBody> {
  const horizon = serverTime + REMINDER_HORIZON_MS;
  const dueAt = fc.oneof(
    pastTimeArb(serverTime),
    timeIn(serverTime, Math.min(horizon, serverTime + HOUR_MS)),
    timeIn(serverTime, horizon),
    fc.constant(horizon),
  );
  return fc
    .record({ dueAt, text: reminderTextArb, language: languageArb, created: fc.double({ min: 0, max: 1, noNaN: true }) })
    .map(({ dueAt: due, text, language, created }) => {
      const latest = Math.min(due, serverTime);
      // Bias towards a creation time close to the latest allowed one.
      const createdAt = Math.max(0, Math.min(latest, Math.floor(latest - created * Math.min(latest, DAY_MS))));
      return { dueAt: due, text, language, createdAt };
    });
}

/** `min` to `max` (at most 5) valid Reminders with unique ids and unique slots, in random slot order. */
export function remindersArb(
  serverTime: number,
  min = 0,
  max = REMINDER_LIMIT,
): fc.Arbitrary<readonly SnapshotReminder[]> {
  return fc
    .record({
      ids: fc.uniqueArray(reminderIdArb, { minLength: min, maxLength: max }),
      slots: fc.shuffledSubarray([...SLOTS], { minLength: min, maxLength: max }),
      bodies: fc.array(reminderBodyArb(serverTime), { minLength: min, maxLength: max }),
    })
    .map(({ ids, slots, bodies }) => {
      const n = Math.min(ids.length, slots.length, bodies.length);
      return bodies.slice(0, n).map((body, i): SnapshotReminder => ({
        id: ids[i] ?? `r:${String(i)}`,
        slot: slots[i] ?? 1,
        ...body,
      }));
    });
}

/**
 * A valid Session_Snapshot at `serverTime`: STOP on or off, 0 to 120 receive
 * times, a Slow_Down_Text time or none, counters for today or another day, and
 * 0 to 5 Reminders (some past due) with unique ids and slots. Always accepted
 * by `parseSnapshot(…, serverTime, …)`.
 */
export function snapshotArb(serverTime: number): fc.Arbitrary<SessionSnapshot> {
  return fc.record({
    stopped: fc.boolean(),
    receiveTimes: receiveTimesArb(serverTime),
    slowDownAt: fc.option(pastTimeArb(serverTime), { nil: null }),
    counters: countersArb(serverTime),
    reminders: remindersArb(serverTime),
  });
}

/** A Server_Time together with a valid Session_Snapshot at that time. */
export const snapshotAtArb: fc.Arbitrary<{ readonly serverTime: number; readonly snapshot: SessionSnapshot }> =
  serverTimeArb.chain((serverTime) =>
    snapshotArb(serverTime).map((snapshot) => ({ serverTime, snapshot })),
  );

// ---------------------------------------------------------------------------
// Invalid snapshots: each breaks exactly one rule of Requirement 8.4.
// ---------------------------------------------------------------------------

/** An invalid Session_Snapshot and the SnapshotError the parser must report for it. */
export interface SnapshotViolation {
  readonly rule: SnapshotError;
  readonly snapshot: unknown;
}

function top(s: SessionSnapshot, patch: Json): Json {
  return { ...s, ...patch };
}

function withCounters(s: SessionSnapshot, patch: Json): Json {
  return top(s, { counters: { ...s.counters, ...patch } });
}

function withReminder(s: SessionSnapshot, index: number, patch: Json): Json {
  return top(s, { reminders: s.reminders.map((r, i) => (i === index ? { ...r, ...patch } : r)) });
}

function without(o: object, key: string): Json {
  return Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
}

function violation(rule: SnapshotError, snapshot: unknown): SnapshotViolation {
  return { rule, snapshot };
}

/** A base snapshot with at least `min` Reminders and an index picker. */
function withRemindersArb(serverTime: number, min: number) {
  return fc.record({
    base: snapshotArb(serverTime).chain((s) =>
      s.reminders.length >= min
        ? fc.constant(s)
        : remindersArb(serverTime, min).map((reminders) => ({ ...s, reminders })),
    ),
    pick: fc.nat(),
    other: fc.nat(),
  });
}

/** Two distinct indexes below `n` (n ≥ 2). */
function twoIndexes(n: number, pick: number, other: number): [number, number] {
  const i = pick % n;
  return [i, (i + 1 + (other % (n - 1))) % n];
}

function extraKeyArb(keys: readonly string[]): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constantFrom('number', 'phone', 'sender', 'extra'),
    fc.string({ minLength: 1, maxLength: 12 }),
  ).filter((k) => !keys.includes(k) && k !== '__proto__');
}

// JSON-safe values of the wrong type for each kind of field.
const NOT_BOOLEAN: readonly unknown[] = ['true', 1, 0, null, {}, []];
const NOT_ARRAY: readonly unknown[] = ['x', 1, true, null, {}];
const NOT_NUMBER: readonly unknown[] = ['1', true, null, {}, []];
const NOT_NUMBER_OR_NULL: readonly unknown[] = ['1', true, {}, []];
const NOT_OBJECT: readonly unknown[] = ['x', 1, true, null, []];
const NOT_STRING: readonly unknown[] = [1, true, null, {}, []];

const pickArb = (values: readonly unknown[]): fc.Arbitrary<unknown> => fc.constantFrom(...values);

function notObjectArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  return fc
    .oneof(fc.constantFrom<unknown>(null, [], 'snapshot', 42, true), snapshotArb(serverTime).map((s) => [s]))
    .map((v) => violation('not-object', v));
}

function unknownFieldArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  const value = fc.jsonValue();
  return fc.oneof(
    fc
      .record({ s: snapshotArb(serverTime), k: extraKeyArb(TOP_KEYS), v: value })
      .map(({ s, k, v }) => violation('unknown-field', top(s, { [k]: v }))),
    fc
      .record({ s: snapshotArb(serverTime), k: extraKeyArb(COUNTER_KEYS), v: value })
      .map(({ s, k, v }) => violation('unknown-field', withCounters(s, { [k]: v }))),
    fc
      .record({ r: withRemindersArb(serverTime, 1), k: extraKeyArb(REMINDER_KEYS), v: value })
      .map(({ r, k, v }) =>
        violation('unknown-field', withReminder(r.base, r.pick % r.base.reminders.length, { [k]: v })),
      ),
  );
}

function missingFieldArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  return fc.oneof(
    fc
      .record({ s: snapshotArb(serverTime), k: fc.constantFrom(...TOP_KEYS) })
      .map(({ s, k }) => violation('missing-field', without(s, k))),
    fc
      .record({ s: snapshotArb(serverTime), k: fc.constantFrom(...COUNTER_KEYS) })
      .map(({ s, k }) => violation('missing-field', top(s, { counters: without(s.counters, k) }))),
    fc.record({ r: withRemindersArb(serverTime, 1), k: fc.constantFrom(...REMINDER_KEYS) }).map(({ r, k }) => {
      const i = r.pick % r.base.reminders.length;
      const reminders = r.base.reminders.map((rem, j) => (j === i ? without(rem, k) : rem));
      return violation('missing-field', top(r.base, { reminders }));
    }),
  );
}

function wrongTypeArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  const s = snapshotArb(serverTime);
  const wrong = (patch: (snap: SessionSnapshot, v: unknown) => Json, values: readonly unknown[]) =>
    fc.record({ s, v: pickArb(values) }).map(({ s: snap, v }) => violation('wrong-type', patch(snap, v)));
  const reminderField = (key: (typeof REMINDER_KEYS)[number], values: readonly unknown[]) =>
    fc
      .record({ r: withRemindersArb(serverTime, 1), v: pickArb(values) })
      .map(({ r, v }) =>
        violation('wrong-type', withReminder(r.base, r.pick % r.base.reminders.length, { [key]: v })),
      );
  return fc.oneof(
    wrong((snap, v) => top(snap, { stopped: v }), NOT_BOOLEAN),
    wrong((snap, v) => top(snap, { receiveTimes: v }), NOT_ARRAY),
    fc
      .record({ s, v: pickArb(NOT_NUMBER), at: fc.nat() })
      .map(({ s: snap, v, at }) => {
        const times: unknown[] = [...snap.receiveTimes];
        if (times.length === 0) times.push(v);
        else times[at % times.length] = v;
        return violation('wrong-type', top(snap, { receiveTimes: times }));
      }),
    wrong((snap, v) => top(snap, { slowDownAt: v }), NOT_NUMBER_OR_NULL),
    wrong((snap, v) => top(snap, { counters: v }), NOT_OBJECT),
    wrong((snap, v) => withCounters(snap, { dayKey: v }), NOT_STRING),
    fc
      .record({ s, v: pickArb(NOT_NUMBER), k: fc.constantFrom(...COUNT_KEYS) })
      .map(({ s: snap, v, k }) => violation('wrong-type', withCounters(snap, { [k]: v }))),
    wrong((snap, v) => top(snap, { reminders: v }), NOT_ARRAY),
    fc.record({ r: withRemindersArb(serverTime, 1), v: pickArb(NOT_OBJECT) }).map(({ r, v }) => {
      const i = r.pick % r.base.reminders.length;
      return violation('wrong-type', top(r.base, { reminders: r.base.reminders.map((rem, j) => (j === i ? v : rem)) }));
    }),
    reminderField('id', NOT_STRING),
    reminderField('slot', NOT_NUMBER),
    reminderField('dueAt', NOT_NUMBER),
    reminderField('text', NOT_STRING),
    reminderField('language', NOT_STRING),
    reminderField('createdAt', NOT_NUMBER),
  );
}

function tooManyTimesArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  return fc
    .record({
      s: snapshotArb(serverTime),
      times: fc.array(pastTimeArb(serverTime), { minLength: MAX_ARB_TIMES + 1, maxLength: MAX_ARB_TIMES + 10 }),
    })
    .map(({ s, times }) => violation('too-many-times', top(s, { receiveTimes: sorted(times) })));
}

/** Exactly one decreasing pair `hi, lo` with sorted times before and after it. */
function timesOrderArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  return fc
    .record({
      s: snapshotArb(serverTime),
      lo: timeIn(0, serverTime - 1),
      gap: timeIn(1, serverTime),
      before: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 50 }),
      after: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 50 }),
    })
    .map(({ s, lo, gap, before, after }) => {
      const hi = Math.min(serverTime, lo + gap);
      const prefix = sorted(before.map((f) => Math.floor(f * lo)));
      const suffix = sorted(after.map((f) => lo + Math.floor(f * (serverTime - lo))));
      return violation('times-order', top(s, { receiveTimes: [...prefix, hi, lo, ...suffix] }));
    });
}

/** 6 Reminders with unique ids. Six Reminders cannot have unique slots 1..5; the length rule is checked first. */
function tooManyRemindersArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  const n = REMINDER_LIMIT + 1;
  return fc
    .record({
      s: snapshotArb(serverTime),
      ids: fc.uniqueArray(reminderIdArb, { minLength: n, maxLength: n }),
      slots: fc.shuffledSubarray([...SLOTS], { minLength: SLOTS.length, maxLength: SLOTS.length }),
      extraSlot: fc.constantFrom(...SLOTS),
      bodies: fc.array(reminderBodyArb(serverTime), { minLength: n, maxLength: n }),
    })
    .map(({ s, ids, slots, extraSlot, bodies }) => {
      const allSlots = [...slots, extraSlot];
      const reminders = bodies.map((body, i) => ({ id: ids[i], slot: allSlots[i], ...body }));
      return violation('too-many-reminders', top(s, { reminders }));
    });
}

function reminderPatchArb(
  serverTime: number,
  rule: SnapshotError,
  patchArb: fc.Arbitrary<Json>,
): fc.Arbitrary<SnapshotViolation> {
  return fc
    .record({ r: withRemindersArb(serverTime, 1), patch: patchArb })
    .map(({ r, patch }) => violation(rule, withReminder(r.base, r.pick % r.base.reminders.length, patch)));
}

function badReminderIdArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  const id = fc.oneof(fc.constant(''), fc.string({ minLength: MAX_ARB_ID + 1, maxLength: MAX_ARB_ID + 40 }));
  return reminderPatchArb(serverTime, 'bad-reminder-id', id.map((v) => ({ id: v })));
}

function badSlotArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  const slot = fc.constantFrom(0, 6, -1, 2.5, 100);
  return reminderPatchArb(serverTime, 'bad-slot', slot.map((v) => ({ slot: v })));
}

function duplicateArb(serverTime: number, key: 'id' | 'slot'): fc.Arbitrary<SnapshotViolation> {
  return withRemindersArb(serverTime, 2).map(({ base, pick, other }) => {
    const [i, j] = twoIndexes(base.reminders.length, pick, other);
    const source = base.reminders[i];
    const value: unknown = source === undefined ? undefined : source[key];
    return violation(key === 'id' ? 'duplicate-id' : 'duplicate-slot', withReminder(base, j, { [key]: value }));
  });
}

function badTextArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  const text = fc.oneof(
    fc.constant(''),
    fc.string({ minLength: REMINDER_TEXT_MAX + 1, maxLength: REMINDER_TEXT_MAX + 60 }),
  );
  return reminderPatchArb(serverTime, 'bad-text', text.map((v) => ({ text: v })));
}

function dueTooFarArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  const dueAt = timeIn(1, REMINDER_HORIZON_MS).map((d) => serverTime + REMINDER_HORIZON_MS + d);
  return reminderPatchArb(serverTime, 'due-too-far', dueAt.map((v) => ({ dueAt: v })));
}

/** Due_Time before the Server_Time and a creation time after it but not after the Server_Time. */
function createdAfterDueArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  const patch = fc
    .record({ dueAt: timeIn(0, serverTime - 1), gap: timeIn(1, serverTime) })
    .map(({ dueAt, gap }) => ({ dueAt, createdAt: Math.min(serverTime, dueAt + gap) }));
  return reminderPatchArb(serverTime, 'created-after-due', patch);
}

function timeInFutureArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  const ahead = timeIn(1, 1_000_000_000).map((d) => serverTime + d);
  const createdPatch = fc
    .record({ d: timeIn(1, REMINDER_HORIZON_MS), c: timeIn(1, REMINDER_HORIZON_MS) })
    .map(({ d, c }) => ({ dueAt: serverTime + d, createdAt: serverTime + 1 + ((c - 1) % d) }));
  return fc.oneof(
    fc
      .record({ s: snapshotArb(serverTime), t: ahead })
      .map(({ s, t }) =>
        violation('time-in-future', top(s, { receiveTimes: [...s.receiveTimes.slice(0, MAX_ARB_TIMES - 1), t] })),
      ),
    fc
      .record({ s: snapshotArb(serverTime), t: ahead })
      .map(({ s, t }) => violation('time-in-future', top(s, { slowDownAt: t }))),
    reminderPatchArb(serverTime, 'time-in-future', createdPatch),
  );
}

function badLanguageArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  const language = fc.constantFrom('fr', 'EN', 'Urdu', 'roman_ur', '', 'ur ');
  return reminderPatchArb(serverTime, 'bad-language', language.map((v) => ({ language: v })));
}

/** A negative, non-integer or too large count or time, placed so no other rule breaks. */
function badCountArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  const s = snapshotArb(serverTime);
  const negative = timeIn(-1_000_000_000, -1);
  const badCount = fc.oneof(
    negative,
    timeIn(0, MAX_ARB_COUNT - 1).map((n) => n + 0.5),
    timeIn(MAX_ARB_COUNT + 1, 1_000_000_000),
  );
  return fc.oneof(
    fc
      .record({ s, k: fc.constantFrom(...COUNT_KEYS), v: badCount })
      .map(({ s: snap, k, v }) => violation('bad-count', withCounters(snap, { [k]: v }))),
    // Placed first and below every valid time, so the order rule still holds.
    fc
      .record({ s, v: fc.oneof(negative, fc.constant(-0.5)) })
      .map(({ s: snap, v }) =>
        violation('bad-count', top(snap, { receiveTimes: [v, ...snap.receiveTimes.slice(0, MAX_ARB_TIMES - 1)] })),
      ),
    fc
      .record({ s, v: fc.oneof(negative, fc.constant(0.5)) })
      .map(({ s: snap, v }) => violation('bad-count', top(snap, { slowDownAt: v }))),
    withRemindersArb(serverTime, 1).map(({ base, pick }) => {
      const i = pick % base.reminders.length;
      const r = base.reminders[i];
      const dueAt = r === undefined ? 0 : r.dueAt;
      // Still after the creation time and inside the horizon.
      const bad = dueAt === serverTime + REMINDER_HORIZON_MS ? dueAt - 0.5 : dueAt + 0.5;
      return violation('bad-count', withReminder(base, i, { dueAt: bad }));
    }),
    withRemindersArb(serverTime, 1).map(({ base, pick }) => {
      const i = pick % base.reminders.length;
      const createdAt = base.reminders[i]?.createdAt ?? 0;
      return violation('bad-count', withReminder(base, i, { createdAt: createdAt > 0 ? createdAt - 0.5 : -1 }));
    }),
  );
}

function badDayKeyArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  const dayKey = fc.constantFrom(
    '2025-1-15',
    '20250115',
    '',
    'today',
    '2025-01-15 ',
    ' 2025-01-15',
    '2025/01/15',
    '2025-01-15T00:00',
    '۲۰۲۵-۰۱-۱۵',
  );
  return fc
    .record({ s: snapshotArb(serverTime), dayKey })
    .map(({ s, dayKey: v }) => violation('bad-day-key', withCounters(s, { dayKey: v })));
}

/**
 * An invalid Session_Snapshot at `serverTime` that breaks exactly one rule of
 * Requirement 8.4, with the SnapshotError `parseSnapshot` reports for it. Every
 * value is JSON-safe, so it survives `JSON.stringify` in handler tests.
 */
export function snapshotViolationArb(serverTime: number): fc.Arbitrary<SnapshotViolation> {
  return fc.oneof(
    notObjectArb(serverTime),
    unknownFieldArb(serverTime),
    missingFieldArb(serverTime),
    wrongTypeArb(serverTime),
    tooManyTimesArb(serverTime),
    timesOrderArb(serverTime),
    tooManyRemindersArb(serverTime),
    badReminderIdArb(serverTime),
    badSlotArb(serverTime),
    duplicateArb(serverTime, 'slot'),
    duplicateArb(serverTime, 'id'),
    badTextArb(serverTime),
    dueTooFarArb(serverTime),
    createdAfterDueArb(serverTime),
    timeInFutureArb(serverTime),
    badLanguageArb(serverTime),
    badCountArb(serverTime),
    badDayKeyArb(serverTime),
  );
}

/** A Server_Time together with an invalid Session_Snapshot at that time. */
export const snapshotViolationAtArb: fc.Arbitrary<{
  readonly serverTime: number;
  readonly violation: SnapshotViolation;
}> = serverTimeArb.chain((serverTime) =>
  snapshotViolationArb(serverTime).map((v) => ({ serverTime, violation: v })),
);
