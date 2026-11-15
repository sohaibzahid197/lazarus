// Reminder branch of the Gateway_Pipeline (sms-reminders design, "Pipeline
// integration" and "REMIND, LIST and CANCEL inside the Gateway_Pipeline").
// Pure: runs after every gateway check passed; no clock, storage or network.
// The only StateChange holding body-derived text is `reminder-add` (5.12, 14.7).
import { releaseParts, reserveParts } from './gateway.counters.js';
import { GATEWAY_TEXTS } from './gateway.texts.js';
import type { CanonicalNumber, GatewayDecision, StateChange } from './gateway.types.js';
import { formatWhen } from './reminder.clock.js';
import { formatReminderList } from './reminder.list.js';
import { parseReminder, toDigitValue } from './reminder.parse.js';
import { resolveDueTime } from './reminder.resolve.js';
import { activeFor, findBySlot, lowestFreeSlot } from './reminder.store.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import type { Reminder, ReminderId, ReminderState } from './reminder.types.js';
import type { RoutedCommand } from './router.types.js';

export interface ReminderReply {
  /** Reply_Text. */
  readonly text: string;
  /** At most one reminder-add or reminder-remove. */
  readonly changes: readonly StateChange[];
}

export type ReminderCommand = RoutedCommand & { readonly command: 'REMIND' | 'LIST' | 'CANCEL' };

/** The REMIND message being handled; the reminder always belongs to `number` (5.12). */
interface RemindInput {
  readonly routed: ReminderCommand;
  readonly number: CanonicalNumber;
  readonly messageId: string;
  readonly receivedAt: number;
  readonly active: readonly Reminder[];
}

const textOnly = (text: string): ReminderReply => ({ text, changes: [] });

/** `2`, `02`, `002`, `۲` → 2 (7.2). Only called on a router-validated token; NaN otherwise. */
export function parseSlotArgument(argument: string): number {
  return toDigitValue(argument.trim());
}

function newReminder(input: RemindInput, slot: Reminder['slot'], dueAt: number, text: string): Reminder {
  return {
    id: `r:${input.messageId}` as ReminderId,
    number: input.number,
    slot,
    dueAt,
    text,
    language: input.routed.language,
    createdAt: input.receivedAt,
    handedAt: null,
  };
}

/** REMIND: Reminder_Limit before parsing (5.8, 5.14), then parse and resolve errors (5.3–5.7). */
function remindReply(input: RemindInput): ReminderReply {
  const { language, argument, argumentMissing } = input.routed;
  const texts = REMINDER_TEXTS[language];
  if (argumentMissing) return textOnly(GATEWAY_TEXTS[language].usage.REMIND);
  const slot = lowestFreeSlot(input.active);
  if (slot === null) return textOnly(texts.limit);
  const parsed = parseReminder(argument);
  if (!parsed.ok) {
    if (parsed.error === 'no-text') return textOnly(GATEWAY_TEXTS[language].usage.REMIND);
    return textOnly(parsed.error === 'no-time' ? texts.timeHelp : texts.tooLong);
  }
  const resolved = resolveDueTime(parsed.expr, input.receivedAt);
  if (!resolved.ok) return textOnly(resolved.error === 'past' ? texts.past : texts.tooFar);
  const reminder = newReminder(input, slot, resolved.dueAt, parsed.text);
  return {
    text: texts.set(slot, formatWhen(resolved.dueAt, language)),
    changes: [{ type: 'reminder-add', reminder }],
  };
}

/** LIST: No_Reminders_Text or the List_Formatter over the sender's reminders only (6.1, 6.5–6.7). */
function listReply(
  routed: ReminderCommand,
  active: readonly Reminder[],
  split: (text: string) => string[],
): ReminderReply {
  if (active.length === 0) return textOnly(REMINDER_TEXTS[routed.language].noReminders);
  return textOnly(formatReminderList(active, routed.language, split));
}

/** The sender's Active_Reminder in the CANCEL slot, or null (7.2, 7.3). */
function cancelTarget(routed: RoutedCommand, active: readonly Reminder[]): Reminder | null {
  if (routed.argumentMissing) return null;
  const slot = parseSlotArgument(routed.argument);
  return Number.isNaN(slot) ? null : findBySlot(active, slot);
}

/** CANCEL: Cancel_Usage_Text, reminder-remove, or No_Such_Reminder_Text (7.1–7.5). */
function cancelReply(routed: ReminderCommand, active: readonly Reminder[]): ReminderReply {
  const texts = REMINDER_TEXTS[routed.language];
  if (routed.argumentMissing) return textOnly(texts.cancelUsage);
  const target = cancelTarget(routed, active);
  if (target === null) return textOnly(texts.noSuch);
  return {
    text: texts.cancelled(target.slot),
    changes: [{ type: 'reminder-remove', id: target.id }],
  };
}

/** REMIND, LIST, CANCEL after all gateway checks passed (Requirements 5–7, 12.7). */
export function reminderReply(
  routed: ReminderCommand,
  number: CanonicalNumber,
  messageId: string,
  receivedAt: number,
  reminders: ReminderState,
  split: (text: string) => string[],
): ReminderReply {
  if (reminders.status === 'unreadable') {
    return textOnly(REMINDER_TEXTS[routed.language].unavailable);
  }
  const active = activeFor(reminders, number);
  switch (routed.command) {
    case 'REMIND':
      return remindReply({ routed, number, messageId, receivedAt, active });
    case 'LIST':
      return listReply(routed, active, split);
    case 'CANCEL':
      return cancelReply(routed, active);
  }
}

/** CANCEL at handed >= cap still removes the reminder (7.7); REMIND and LIST change nothing. */
export function cappedReminderChanges(
  routed: RoutedCommand,
  number: CanonicalNumber,
  reminders: ReminderState,
): readonly StateChange[] {
  if (routed.command !== 'CANCEL' || reminders.status === 'unreadable') return [];
  const target = cancelTarget(routed, activeFor(reminders, number));
  return target === null ? [] : [{ type: 'reminder-remove', id: target.id }];
}

const isReminderWrite = (c: StateChange): boolean =>
  c.type === 'reminder-add' || c.type === 'reminder-remove';

/** Moves a counters reservation from `oldParts` to `newParts` handed parts. */
function rebook(change: StateChange, oldParts: number, newParts: number): StateChange {
  if (change.type !== 'counters') return change;
  const { counters } = change;
  const next =
    newParts >= oldParts
      ? reserveParts(counters, counters.dayKey, newParts - oldParts)
      : releaseParts(counters, counters.dayKey, oldParts - newParts);
  return { type: 'counters', counters: next };
}

/**
 * 12.11: the commit of a reminder-add or reminder-remove failed. Drops those
 * changes and, when parts were to be sent, replies with the
 * Reminders_Unavailable_Text instead, rebooking the reserved parts.
 */
export function reminderWriteFailed(
  decision: GatewayDecision,
  split: (text: string) => string[],
): GatewayDecision {
  const kept = decision.changes.filter((c) => !isReminderWrite(c));
  if (decision.parts.length === 0) return { ...decision, changes: kept };
  const parts = split(REMINDER_TEXTS[decision.language].unavailable);
  const changes = kept.map((c) => rebook(c, decision.parts.length, parts.length));
  return { ...decision, parts, changes };
}
