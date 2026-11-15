// Reminder wire format between the brain and the Native_Module
// (sms-reminders design, "`loadState()` wire format addition" and "`serializeChanges` additions").
// Pure functions. Decoding never throws: any malformed entry makes the whole store unreadable.
import { isCanonicalNumber } from './gateway.number.js';
import type { CanonicalNumber } from './gateway.types.js';
import { REMINDER_LIMIT, REMINDER_TEXT_MAX } from './reminder.types.js';
import type { Reminder, ReminderId, ReminderSlot, ReminderState } from './reminder.types.js';
import { LANGUAGES, type Language } from './router.types.js';

/** JSON form of one Reminder, with exactly these keys in this order. */
export interface EncodedReminder {
  readonly id: string;
  readonly number: string;
  readonly slot: number;
  readonly dueAt: number;
  readonly text: string;
  readonly language: string;
  readonly createdAt: number;
  readonly handedAt: number | null;
}

const REMINDER_KEYS: readonly string[] = [
  'id',
  'number',
  'slot',
  'dueAt',
  'text',
  'language',
  'createdAt',
  'handedAt',
];

const UNREADABLE: ReminderState = Object.freeze({ status: 'unreadable' });

type JsonRecord = Readonly<Record<string, unknown>>;

/** The `loadState()` / `reminder-add` form of a Reminder (inverse of `decodeReminders`, 12.8). */
export function encodeReminder(r: Reminder): EncodedReminder {
  return {
    id: r.id,
    number: r.number,
    slot: r.slot,
    dueAt: r.dueAt,
    text: r.text,
    language: r.language,
    createdAt: r.createdAt,
    handedAt: r.handedAt,
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: JsonRecord): boolean {
  const keys = Object.keys(value);
  return keys.length === REMINDER_KEYS.length && REMINDER_KEYS.every((k) => Object.prototype.hasOwnProperty.call(value, k));
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isSlot(value: unknown): value is ReminderSlot {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= REMINDER_LIMIT;
}

/** Reminder_Text length is counted in UTF-16 code units (`text.length`). */
function isReminderText(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= REMINDER_TEXT_MAX;
}

function isLanguage(value: unknown): value is Language {
  return (LANGUAGES as readonly unknown[]).includes(value);
}

function isNumber(value: unknown): value is CanonicalNumber {
  return typeof value === 'string' && isCanonicalNumber(value);
}

/** One stored entry as a Reminder, or null when any field is malformed (12.7). */
function decodeEntry(value: unknown): Reminder | null {
  if (!isRecord(value) || !hasExactKeys(value)) return null;
  const { id, number, slot, dueAt, text, language, createdAt, handedAt } = value;
  if (typeof id !== 'string' || !isNumber(number) || !isSlot(slot)) return null;
  if (!isReminderText(text) || !isLanguage(language)) return null;
  if (!isTime(dueAt) || !isTime(createdAt)) return null;
  if (handedAt !== null && !isTime(handedAt)) return null;
  return { id: id as ReminderId, number, slot, dueAt, text, language, createdAt, handedAt };
}

/** True when two Reminders share a `(number, slot)` pair (12.2). */
function hasDuplicateSlot(reminders: readonly Reminder[]): boolean {
  const seen = new Set<string>();
  for (const r of reminders) {
    const key = `${r.number}#${r.slot}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/**
 * Decodes the `reminders` value of `loadState()` (Requirements 12.6, 12.7, 12.8).
 * `null`, `undefined` (missing key), a non-array, any malformed entry or a repeated
 * `(number, slot)` gives `unreadable`, never an empty store.
 */
export function decodeReminders(value: unknown): ReminderState {
  if (!Array.isArray(value)) return UNREADABLE;
  const reminders: Reminder[] = [];
  for (const entry of value as readonly unknown[]) {
    const r = decodeEntry(entry);
    if (r === null) return UNREADABLE;
    reminders.push(r);
  }
  if (hasDuplicateSlot(reminders)) return UNREADABLE;
  return { status: 'ok', reminders };
}
