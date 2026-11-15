// Reminder_Module types and constants (sms-reminders design, "Reminder_Module").
// Pure types only: no clock, storage or network access.
import type { CanonicalNumber, StateChange } from './gateway.types.js';
import type { Language } from './router.types.js';

/** Maximum Active_Reminders per Canonical_Number (Requirement 5.1). */
export const REMINDER_LIMIT = 5;
/** Pakistan_Time is a fixed UTC+05:00 offset (Requirement 3.1). */
export const PK_OFFSET_MS = 18_000_000;
/** Reminder_Horizon: 30 days between receive time and Due_Time (Requirement 3.7). */
export const REMINDER_HORIZON_MS = 2_592_000_000;
/** Late_Window: 60 minutes after the Due_Time (Requirement 10.3). */
export const LATE_WINDOW_MS = 3_600_000;
/**
 * Maximum Reminder_Text length in UTF-16 code units (`text.length`), so an
 * emoji outside the BMP counts as 2 (Requirement 2.15). With the longest
 * deliveryLead (13 units) the Reminder_Delivery_Text is at most 153 units,
 * which always fits 3 SMS parts (Requirement 9.7).
 */
export const REMINDER_TEXT_MAX = 140;

/** `r:<messageId>` of the REMIND Inbound_Message. */
export type ReminderId = string & { readonly __brand: 'ReminderId' };
export type ReminderSlot = 1 | 2 | 3 | 4 | 5;

export interface Reminder {
  readonly id: ReminderId;
  readonly number: CanonicalNumber;
  readonly slot: ReminderSlot;
  readonly dueAt: number;
  /** Reminder_Text, 1 to 140 UTF-16 code units. */
  readonly text: string;
  readonly language: Language;
  /** Receive time of the REMIND message. */
  readonly createdAt: number;
  /** Delivery marker for exactly-once hand-off; null until handed (Requirement 10.15). */
  readonly handedAt: number | null;
}

/** In-memory Reminder_Store; `unreadable` when the store could not be read (Requirement 12.1). */
export type ReminderState =
  | { readonly status: 'ok'; readonly reminders: readonly Reminder[] }
  | { readonly status: 'unreadable' };

export const EMPTY_REMINDERS: ReminderState = Object.freeze({
  status: 'ok',
  reminders: Object.freeze([]) as readonly Reminder[],
});

export type DayWord = 'today' | 'tomorrow';
export type DayPeriod = 'morning' | 'evening' | 'night';
export type DurationUnit = 'minute' | 'hour' | 'day';

export type TimeExpression =
  /** hour is the 24-hour hour; period is set only for a bare hour after a Day_Period. */
  | {
      readonly kind: 'clock';
      readonly day: DayWord | null;
      readonly period: DayPeriod | null;
      readonly hour: number;
      readonly minute: number;
    }
  | { readonly kind: 'period'; readonly day: DayWord | null; readonly period: DayPeriod }
  | { readonly kind: 'relative'; readonly amount: number; readonly unit: DurationUnit };

export type ParseError = 'no-time' | 'no-text' | 'text-too-long' | 'past' | 'too-far';

/** Time_Parser result (Requirement 2). */
export type ParseResult =
  | { readonly ok: true; readonly expr: TimeExpression; readonly text: string }
  | { readonly ok: false; readonly error: Extract<ParseError, 'no-time' | 'no-text' | 'text-too-long'> };

/** Due_Time_Resolver result (Requirement 3). */
export type ResolveResult =
  | { readonly ok: true; readonly dueAt: number }
  | { readonly ok: false; readonly error: Extract<ParseError, 'past' | 'too-far'> };

/** The 6 Delivery_Outcomes (Requirement 10.10). */
export const DELIVERY_OUTCOMES = [
  'reminder-sent',
  'reminder-stopped',
  'reminder-not-allowed',
  'reminder-capped',
  'reminder-expired',
  'reminder-failed',
] as const;
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

/** Delivery_Decision result for one due Reminder. */
export type DeliveryStep =
  /** dueAt > now (Requirement 10.13). */
  | { readonly kind: 'wait' }
  /** Final outcome without sending; changes hold the reminder-remove. */
  | {
      readonly kind: 'final';
      readonly outcome: Exclude<DeliveryOutcome, 'reminder-sent' | 'reminder-failed'>;
      readonly changes: readonly StateChange[];
    }
  /** Send parts; changes hold reminder-handed and the counters reserve. */
  | {
      readonly kind: 'send';
      readonly parts: readonly string[];
      readonly changes: readonly StateChange[];
    };
