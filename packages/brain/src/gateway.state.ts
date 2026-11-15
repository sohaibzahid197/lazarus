// State wire format between the brain and the Native_Module
// (necromancer-sms-gateway design, "Persistence": `loadState()` and `commit(changesJson)`).
// Pure functions. Decoding never throws: malformed parts fall back to safe values.
import { zeroCounters } from './gateway.counters.js';
import { isCanonicalNumber } from './gateway.number.js';
import { parseSettings, type ParsedSettings } from './gateway.settings.js';
import type { CanonicalNumber, DayCounters, GatewayState, StateChange } from './gateway.types.js';
import { decodeReminders, encodeReminder } from './reminder.state.js';

/**
 * Result of decoding the `loadState()` JSON.
 * `unreadable` means the payload or its Stop_List could not be decoded; the glue must
 * hold the queue as for a rejected `loadState()` (Requirements 3.7, 3.11), because an
 * empty Stop_List would let a stopped number receive SMS.
 */
export type DecodedState =
  | {
      readonly status: 'ok';
      readonly state: GatewayState;
      readonly paused: boolean;
      /** `invalid` drives the "Settings were reset to defaults" banner (Requirement 15.5). */
      readonly settingsStatus: ParsedSettings['status'];
    }
  | { readonly status: 'unreadable' };

type JsonRecord = Record<string, unknown>;

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTER_KEYS = ['received', 'repliesSent', 'replied', 'partsSent', 'ignored', 'handed'] as const;

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function asNumber(value: unknown): CanonicalNumber | null {
  return typeof value === 'string' && isCanonicalNumber(value) ? value : null;
}

/** Canonical numbers from a JSON array; anything else in the array is dropped. */
function decodeNumberSet(values: readonly unknown[]): ReadonlySet<CanonicalNumber> {
  const out = new Set<CanonicalNumber>();
  for (const v of values) {
    const n = asNumber(v);
    if (n !== null) out.add(n);
  }
  return out;
}

/** `null` (failed read) or any non-array maps to `'unreadable'` (Requirement 4.9). */
function decodeAllowlist(value: unknown): GatewayState['allowlist'] {
  return Array.isArray(value) ? decodeNumberSet(value) : 'unreadable';
}

/** `[[number, [t, ...]], ...]`; invalid numbers and times are dropped, times sorted ascending. */
function decodeRate(value: unknown): GatewayState['rate'] {
  const out = new Map<CanonicalNumber, number[]>();
  if (!Array.isArray(value)) return out;
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || !Array.isArray(entry[1])) continue;
    const n = asNumber(entry[0]);
    if (n === null) continue;
    const times = (entry[1] as unknown[]).filter(isTime);
    out.set(n, [...(out.get(n) ?? []), ...times].sort((a, b) => a - b));
  }
  return out;
}

/** `[[number, t], ...]`; the latest time wins for a repeated number. */
function decodeSlowDown(value: unknown): GatewayState['slowDown'] {
  const out = new Map<CanonicalNumber, number>();
  if (!Array.isArray(value)) return out;
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const n = asNumber(entry[0]);
    const t: unknown = entry[1];
    if (n === null || !isTime(t)) continue;
    out.set(n, Math.max(t, out.get(n) ?? t));
  }
  return out;
}

/** Stored DayCounters, or zero counters for `today` when absent or malformed. */
function decodeCounters(value: unknown, today: string): DayCounters {
  if (!isRecord(value)) return zeroCounters(today);
  const { dayKey } = value;
  if (typeof dayKey !== 'string' || !DAY_KEY_RE.test(dayKey)) return zeroCounters(today);
  if (!COUNTER_KEYS.every((k) => isTime(value[k]))) return zeroCounters(today);
  const n = (k: (typeof COUNTER_KEYS)[number]): number => value[k] as number;
  return {
    dayKey,
    received: n('received'),
    repliesSent: n('repliesSent'),
    replied: n('replied'),
    partsSent: n('partsSent'),
    ignored: n('ignored'),
    handed: n('handed'),
  };
}

/**
 * Decodes the `loadState()` JSON (Requirements 3.7, 4.9, 10.6, 15.2, 15.5).
 * `today` is the local day key used when stored counters are absent or malformed.
 * Settings go through `parseSettings`; `missing` and `invalid` both carry the defaults.
 * Only `paused: true` counts as paused.
 */
export function decodeStoredState(json: string, today: string): DecodedState {
  const root = safeJson(json);
  if (!isRecord(root) || !Array.isArray(root.stopList)) return { status: 'unreadable' };
  const rawSettings = typeof root.settings === 'string' ? root.settings : null;
  const parsed: ParsedSettings =
    root.settings === null || typeof root.settings === 'string'
      ? parseSettings(rawSettings)
      : { ...parseSettings(null), status: 'invalid' };
  const state: GatewayState = {
    stopList: decodeNumberSet(root.stopList),
    allowlist: decodeAllowlist(root.allowlist),
    rate: decodeRate(root.rate),
    slowDown: decodeSlowDown(root.slowDown),
    counters: decodeCounters(root.counters, today),
    settings: parsed.settings,
    // A missing or null key decodes as unreadable, never as empty (sms-reminders 12.7).
    reminders: decodeReminders(root.reminders),
  };
  return { status: 'ok', state, paused: root.paused === true, settingsStatus: parsed.status };
}

function encodeChange(c: StateChange): JsonRecord {
  switch (c.type) {
    case 'rate-record':
    case 'slowdown-record':
      return { type: c.type, number: c.number, at: c.at };
    case 'counters':
      return { type: c.type, counters: { ...c.counters } };
    // Reminder changes (sms-reminders design, "`serializeChanges` additions").
    case 'reminder-add':
      return { type: c.type, reminder: encodeReminder(c.reminder) };
    case 'reminder-remove':
      return { type: c.type, id: c.id };
    case 'reminder-handed':
      return { type: c.type, id: c.id, at: c.at };
    case 'reminder-remove-all':
    default:
      return { type: c.type, number: c.number };
  }
}

/** JSON for `NativeStore.commit(changesJson)`: the `StateChange[]` with exactly its declared keys. */
export function serializeChanges(changes: readonly StateChange[]): string {
  return JSON.stringify(changes.map(encodeChange));
}
