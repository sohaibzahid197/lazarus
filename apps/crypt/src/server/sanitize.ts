import 'server-only';
// Redaction and masking of free-text response fields (Requirements 9.6, 17.2; design C4).
// Only reply part texts, Reminder_Texts and the Slow_Down_Text pass through here.
// Structural strings (day key, Reminder_Ids, enums) are left alone: the brain's
// mask regex would read `2025-01-15` as one 8-digit run and corrupt the day key.
import { REMINDER_TEXT_MAX, maskPhoneNumbers, redactSecrets } from '@lazarus/brain';
import type { SessionSnapshot, SnapshotReminder } from '../protocol/snapshot.types';

/** Redacts every secret first, then masks phone-number-like digit runs (9.6, 17.2). */
export function sanitizeText(text: string, secrets: readonly string[]): string {
  return maskPhoneNumbers(redactSecrets(text, secrets));
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Keeps a Reminder_Text within 140 UTF-16 code units, or 139 when unit 140 is
 * a high surrogate, so the next request's snapshot stays valid. Only needed
 * when a secret is shorter than `[redacted]`; masking keeps the length.
 */
function clampReminderText(text: string): string {
  if (text.length <= REMINDER_TEXT_MAX) return text;
  const end = isHighSurrogate(text.charCodeAt(REMINDER_TEXT_MAX - 1))
    ? REMINDER_TEXT_MAX - 1
    : REMINDER_TEXT_MAX;
  return text.slice(0, end);
}

function sanitizeReminder(r: SnapshotReminder, secrets: readonly string[]): SnapshotReminder {
  return { ...r, text: clampReminderText(sanitizeText(r.text, secrets)) };
}

/** Sanitizes the Reminder_Texts of a snapshot; every other field is returned unchanged (C4). */
export function sanitizeSnapshot(s: SessionSnapshot, secrets: readonly string[]): SessionSnapshot {
  return { ...s, reminders: s.reminders.map((r) => sanitizeReminder(r, secrets)) };
}
