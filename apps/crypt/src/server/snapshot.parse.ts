import 'server-only';
import {
  DEFAULT_SETTINGS,
  LANGUAGES,
  REMINDER_HORIZON_MS,
  REMINDER_LIMIT,
  REMINDER_TEXT_MAX,
  type CanonicalNumber,
  type DayCounters,
  type GatewayState,
  type Language,
  type Reminder,
  type ReminderId,
  type ReminderSlot,
} from '@lazarus/brain';

// Snapshot_Parser (Requirements 8.2, 8.4, 8.8): validates a browser-held
// Session_Snapshot and rebuilds the Gateway_State of the Simulator_Session.
// The detailed error is for tests; the route always answers `invalid-snapshot`.

export type SnapshotError =
  | 'not-object'
  | 'unknown-field'
  | 'missing-field'
  | 'wrong-type'
  | 'too-many-times'
  | 'times-order'
  | 'too-many-reminders'
  | 'bad-reminder-id'
  | 'bad-slot'
  | 'duplicate-slot'
  | 'duplicate-id'
  | 'bad-text'
  | 'due-too-far'
  | 'created-after-due'
  | 'time-in-future'
  | 'bad-language'
  | 'bad-count'
  | 'bad-day-key';

export type ParseSnapshotResult =
  | { readonly ok: true; readonly state: GatewayState }
  | { readonly ok: false; readonly error: SnapshotError };

const MAX_RECEIVE_TIMES = 120;
const MAX_COUNT = 1_000_000;
const MAX_REMINDER_ID = 64;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOP_KEYS = ['stopped', 'receiveTimes', 'slowDownAt', 'counters', 'reminders'] as const;
const COUNT_KEYS = ['received', 'repliesSent', 'replied', 'partsSent', 'ignored', 'handed'] as const;
const COUNTER_KEYS = ['dayKey', ...COUNT_KEYS] as const;
const REMINDER_KEYS = ['id', 'slot', 'dueAt', 'text', 'language', 'createdAt'] as const;

type Obj = Readonly<Record<string, unknown>>;

/** Internal early exit; never escapes `parseSnapshot`. */
class SnapshotFail extends Error {
  constructor(readonly code: SnapshotError) {
    super(code);
  }
}

function fail(code: SnapshotError): never {
  throw new SnapshotFail(code);
}

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An object with exactly `keys`: extra keys are `unknown-field`, absent ones `missing-field`. */
function exactObject(value: unknown, keys: readonly string[]): Obj {
  if (!isObject(value)) fail('wrong-type');
  if (Object.keys(value).some((k) => !keys.includes(k))) fail('unknown-field');
  if (keys.some((k) => !Object.hasOwn(value, k))) fail('missing-field');
  return value;
}

/** A safe non-negative integer; a non-number is `wrong-type`, a bad number `bad-count`. */
function nonNegInt(value: unknown): number {
  if (typeof value !== 'number') fail('wrong-type');
  if (!Number.isSafeInteger(value) || value < 0) fail('bad-count');
  return value;
}

/** A time that is not later than the Server_Time. */
function pastTime(value: unknown, serverTime: number): number {
  const t = nonNegInt(value);
  if (t > serverTime) fail('time-in-future');
  return t;
}

function readStopped(value: unknown): boolean {
  if (typeof value !== 'boolean') fail('wrong-type');
  return value;
}

function readReceiveTimes(value: unknown, serverTime: number): readonly number[] {
  if (!Array.isArray(value)) fail('wrong-type');
  const items: readonly unknown[] = value;
  if (items.length > MAX_RECEIVE_TIMES) fail('too-many-times');
  const times = items.map((v) => pastTime(v, serverTime));
  if (times.some((t, i) => i > 0 && t < (times[i - 1] ?? t))) fail('times-order');
  return times;
}

function readSlowDownAt(value: unknown, serverTime: number): number | null {
  return value === null ? null : pastTime(value, serverTime);
}

function readCount(value: unknown): number {
  const n = nonNegInt(value);
  if (n > MAX_COUNT) fail('bad-count');
  return n;
}

function readCounters(value: unknown): DayCounters {
  const o = exactObject(value, COUNTER_KEYS);
  const { dayKey } = o;
  if (typeof dayKey !== 'string') fail('wrong-type');
  if (!DAY_KEY_RE.test(dayKey)) fail('bad-day-key');
  return {
    dayKey,
    received: readCount(o.received),
    repliesSent: readCount(o.repliesSent),
    replied: readCount(o.replied),
    partsSent: readCount(o.partsSent),
    ignored: readCount(o.ignored),
    handed: readCount(o.handed),
  };
}

function readReminderId(value: unknown): ReminderId {
  if (typeof value !== 'string') fail('wrong-type');
  if (value.length < 1 || value.length > MAX_REMINDER_ID) fail('bad-reminder-id');
  return value as ReminderId;
}

function readSlot(value: unknown): ReminderSlot {
  if (typeof value !== 'number') fail('wrong-type');
  if (!Number.isInteger(value) || value < 1 || value > REMINDER_LIMIT) fail('bad-slot');
  return value as ReminderSlot;
}

function readText(value: unknown): string {
  if (typeof value !== 'string') fail('wrong-type');
  if (value.length < 1 || value.length > REMINDER_TEXT_MAX) fail('bad-text');
  return value;
}

function readLanguage(value: unknown): Language {
  if (typeof value !== 'string') fail('wrong-type');
  const found = LANGUAGES.find((l) => l === value);
  return found ?? fail('bad-language');
}

function readDueAt(value: unknown, serverTime: number): number {
  const dueAt = nonNegInt(value);
  if (dueAt > serverTime + REMINDER_HORIZON_MS) fail('due-too-far');
  return dueAt;
}

function readCreatedAt(value: unknown, dueAt: number, serverTime: number): number {
  const createdAt = nonNegInt(value);
  if (createdAt > dueAt) fail('created-after-due');
  if (createdAt > serverTime) fail('time-in-future');
  return createdAt;
}

function readReminder(value: unknown, serverTime: number, number: CanonicalNumber): Reminder {
  const o = exactObject(value, REMINDER_KEYS);
  const dueAt = readDueAt(o.dueAt, serverTime);
  return {
    id: readReminderId(o.id),
    number,
    slot: readSlot(o.slot),
    dueAt,
    text: readText(o.text),
    language: readLanguage(o.language),
    createdAt: readCreatedAt(o.createdAt, dueAt, serverTime),
    handedAt: null,
  };
}

function hasDuplicates(values: readonly unknown[]): boolean {
  return new Set(values).size !== values.length;
}

function readReminders(value: unknown, serverTime: number, number: CanonicalNumber): readonly Reminder[] {
  if (!Array.isArray(value)) fail('wrong-type');
  const items: readonly unknown[] = value;
  if (items.length > REMINDER_LIMIT) fail('too-many-reminders');
  const reminders = items.map((r) => readReminder(r, serverTime, number));
  if (hasDuplicates(reminders.map((r) => r.id))) fail('duplicate-id');
  if (hasDuplicates(reminders.map((r) => r.slot))) fail('duplicate-slot');
  return reminders;
}

function buildState(value: unknown, serverTime: number, number: CanonicalNumber): GatewayState {
  if (!isObject(value)) fail('not-object');
  const o = exactObject(value, TOP_KEYS);
  const stopped = readStopped(o.stopped);
  const receiveTimes = readReceiveTimes(o.receiveTimes, serverTime);
  const slowDownAt = readSlowDownAt(o.slowDownAt, serverTime);
  const counters = readCounters(o.counters);
  const reminders = readReminders(o.reminders, serverTime, number);
  return {
    stopList: new Set(stopped ? [number] : []),
    allowlist: new Set<CanonicalNumber>(),
    rate: new Map(receiveTimes.length > 0 ? [[number, receiveTimes]] : []),
    slowDown: new Map(slowDownAt === null ? [] : [[number, slowDownAt]]),
    counters,
    settings: DEFAULT_SETTINGS,
    reminders: { status: 'ok', reminders },
  };
}

/**
 * Validates `value` against every rule of Requirement 8.4 at `serverTime` and
 * returns the Gateway_State with `number` on every entry. Past-due Reminders
 * are accepted unchanged (8.8). Never throws.
 */
export function parseSnapshot(
  value: unknown,
  serverTime: number,
  number: CanonicalNumber,
): ParseSnapshotResult {
  try {
    return { ok: true, state: buildState(value, serverTime, number) };
  } catch (e) {
    if (e instanceof SnapshotFail) return { ok: false, error: e.code };
    throw e;
  }
}
