// Delivery_Decision (sms-reminders design, "Delivery_Decision").
// Pure functions: no clock reads; the glue passes `now` and `today`.
import { notAllowed } from './gateway.checks.js';
import { countersFor, releaseParts, reserveParts } from './gateway.counters.js';
import { maskNumber } from './gateway.number.js';
import type {
  ActivityEntry,
  DayCounters,
  GatewayState,
  SendReport,
  StateChange,
} from './gateway.types.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import { LATE_WINDOW_MS } from './reminder.types.js';
import type { DeliveryOutcome, DeliveryStep, Reminder } from './reminder.types.js';
import { splitSms } from './sms.js';

type FinalDeliveryOutcome = Extract<DeliveryStep, { kind: 'final' }>['outcome'];

const removeChange = (r: Reminder): StateChange => ({ type: 'reminder-remove', id: r.id });

const finalStep = (r: Reminder, outcome: FinalDeliveryOutcome): DeliveryStep => ({
  kind: 'final',
  outcome,
  changes: [removeChange(r)],
});

/** Reminder_Delivery_Text: the Language's lead-in followed by the unchanged Reminder_Text (9.7). */
export function deliveryText(r: Reminder): string {
  return REMINDER_TEXTS[r.language].deliveryLead + r.text;
}

/** Stop_List, Allowlist_Mode, Late_Window in that order (8.4, 10.1–10.3); null when none applies. */
function blockedOutcome(r: Reminder, state: GatewayState, now: number): FinalDeliveryOutcome | null {
  if (state.stopList.has(r.number)) return 'reminder-stopped';
  if (notAllowed(r.number, state)) return 'reminder-not-allowed';
  if (now > r.dueAt + LATE_WINDOW_MS) return 'reminder-expired';
  return null;
}

/**
 * Decides one Reminder (10.1–10.5, 10.9, 10.13). `wait` when not yet due; a
 * final step with `reminder-remove` for stopped, not-allowed, expired or capped;
 * otherwise `send` with the parts, `reminder-handed` at `now` and the counters
 * reserve. Never touches `rate` or `slowDown`.
 */
export function decideDelivery(
  r: Reminder,
  state: GatewayState,
  now: number,
  today: string,
  split: (text: string) => string[] = splitSms,
): DeliveryStep {
  if (r.dueAt > now) return { kind: 'wait' };
  const blocked = blockedOutcome(r, state, now);
  if (blocked !== null) return finalStep(r, blocked);
  const parts = split(deliveryText(r));
  const handed = countersFor(state.counters, today).handed;
  if (handed + parts.length > state.settings.dailySendCap) return finalStep(r, 'reminder-capped');
  const counters = reserveParts(state.counters, today, parts.length);
  return {
    kind: 'send',
    parts,
    changes: [
      { type: 'reminder-handed', id: r.id, at: now },
      { type: 'counters', counters },
    ],
  };
}

/** Delivery_Outcome and parts reported sent for a Sms_Sender report (10.6, 10.7). */
function reportOutcome(
  partCount: number,
  report: SendReport,
): { outcome: DeliveryOutcome; sent: number } {
  if (report.status !== 'done') return { outcome: 'reminder-stopped', sent: 0 };
  const sent = report.results.filter((p) => p === 'sent').length;
  const allSent = sent === partCount && sent === report.results.length;
  return { outcome: allSent ? 'reminder-sent' : 'reminder-failed', sent };
}

/** Releases unsent parts from `handed` and adds sent parts to `partsSent` (10.6, 10.7). */
function settleCounters(
  counters: DayCounters,
  today: string,
  partCount: number,
  sent: number,
): DayCounters {
  const released = releaseParts(counters, today, partCount - sent);
  return { ...released, partsSent: released.partsSent + sent };
}

/**
 * Final Delivery_Outcome after the Sms_Sender report. Changes are always
 * `[reminder-remove, counters]` (10.8).
 */
export function finalizeDelivery(
  r: Reminder,
  partCount: number,
  report: SendReport,
  counters: DayCounters,
  today: string,
): { readonly outcome: DeliveryOutcome; readonly changes: readonly StateChange[] } {
  const { outcome, sent } = reportOutcome(partCount, report);
  const next = settleCounters(counters, today, partCount, sent);
  return { outcome, changes: [removeChange(r), { type: 'counters', counters: next }] };
}

/** Activity_Entry for a Delivery_Outcome; reads only `r.number`, never `r.text` (13.1, 13.4). */
export function buildDeliveryEntry(
  r: Reminder,
  outcome: DeliveryOutcome,
  recordedAt: number,
): ActivityEntry {
  return { receivedAt: recordedAt, who: maskNumber(r.number), command: 'REMIND', outcome };
}

/** The one "reminder processing failed" entry of 11.15; holds no number. */
export function buildProcessingFailedEntry(at: number): ActivityEntry {
  return { receivedAt: at, who: '', command: 'NONE', outcome: 'reminders-failed' };
}
