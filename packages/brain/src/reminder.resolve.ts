/**
 * Due_Time_Resolver (sms-reminders Requirement 3).
 *
 * Turns a Time_Expression and the receive time of the REMIND message (epoch ms)
 * into a Due_Time in Pakistan_Time. Integer arithmetic only: no `Date`, no
 * system clock, no process time zone.
 */

import { DAY_MS, pkDayStart } from './reminder.clock.js';
import {
  REMINDER_HORIZON_MS,
  type DayPeriod,
  type DurationUnit,
  type ResolveResult,
  type TimeExpression,
} from './reminder.types.js';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Milliseconds per Relative_Duration unit (3.5). */
const UNIT_MS: Readonly<Record<DurationUnit, number>> = {
  minute: MINUTE_MS,
  hour: HOUR_MS,
  day: DAY_MS,
};

/** Default wall-clock time of a Day_Period used alone: [hour, minute]. */
const DEFAULT_PERIOD_TIME: Readonly<Record<DayPeriod, readonly [number, number]>> = {
  morning: [9, 0],
  evening: [18, 0],
  night: [21, 0],
};

type WallExpression = Exclude<TimeExpression, { kind: 'relative' }>;

const TOO_FAR: ResolveResult = { ok: false, error: 'too-far' };
const PAST: ResolveResult = { ok: false, error: 'past' };

/** Offset from the start of the Pakistan_Time day, seconds and ms 0 (3.6). */
function wallClockOffset(expr: WallExpression): number {
  const [hour, minute] =
    expr.kind === 'clock' ? [expr.hour, expr.minute] : DEFAULT_PERIOD_TIME[expr.period];
  return hour * HOUR_MS + minute * MINUTE_MS;
}

/** Relative_Duration: horizon check before multiplying, so no overflow (3.5, 3.7). */
function resolveRelative(amount: number, unit: DurationUnit, receivedAt: number): ResolveResult {
  const unitMs = UNIT_MS[unit];
  if (amount > REMINDER_HORIZON_MS / unitMs) return TOO_FAR;
  return { ok: true, dueAt: receivedAt + amount * unitMs };
}

/** Clock_Time or Day_Period on the Pakistan_Time day chosen by the Day_Word (3.2–3.4). */
function resolveWall(expr: WallExpression, receivedAt: number): ResolveResult {
  const today = pkDayStart(receivedAt) + wallClockOffset(expr);
  if (expr.day === 'tomorrow') return { ok: true, dueAt: today + DAY_MS };
  if (expr.day === 'today') return today > receivedAt ? { ok: true, dueAt: today } : PAST;
  return { ok: true, dueAt: today > receivedAt ? today : today + DAY_MS };
}

/** Reject any Due_Time more than the Reminder_Horizon after the receive time (3.7). */
function withinHorizon(result: ResolveResult, receivedAt: number): ResolveResult {
  if (result.ok && result.dueAt - receivedAt > REMINDER_HORIZON_MS) return TOO_FAR;
  return result;
}

/** Resolve a Time_Expression to a Due_Time, `past` or `too-far` (Requirement 3). */
export function resolveDueTime(expr: TimeExpression, receivedAt: number): ResolveResult {
  const result =
    expr.kind === 'relative'
      ? resolveRelative(expr.amount, expr.unit, receivedAt)
      : resolveWall(expr, receivedAt);
  return withinHorizon(result, receivedAt);
}
