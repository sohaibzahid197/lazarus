// Time_Printer (sms-reminders design, "Time_Expression type and Time_Printer").
// Pure functions: prints a valid TimeExpression so the parser can read it back.
import type { DayPeriod, DurationUnit, TimeExpression } from './reminder.types.js';

/** Hour range a Day_Period allows before a bare hour, in 24-hour hours (Requirement 2.6). */
const PERIOD_HOURS: Readonly<Record<DayPeriod, readonly [number, number]>> = {
  morning: [1, 12],
  evening: [13, 23],
  night: [18, 23],
};

const DAY_WORDS: readonly string[] = ['today', 'tomorrow'];
const UNITS: readonly string[] = ['minute', 'hour', 'day'];
const MAX_AMOUNT = 999_999;

const isIntIn = (n: number, min: number, max: number): boolean =>
  Number.isInteger(n) && n >= min && n <= max;

const PERIODS: readonly string[] = ['morning', 'evening', 'night'];

const isPeriod = (p: string): p is DayPeriod => PERIODS.includes(p);

const isDay = (d: string | null): boolean => d === null || DAY_WORDS.includes(d);

/** `H:MM` with no leading zero on the hour and 2 digits of minutes. */
const clock = (hour: number, minute: number): string =>
  `${String(hour)}:${String(minute).padStart(2, '0')}`;

/** Bare hour after a Day_Period: 13–23 print as 1–11, others unchanged (Requirement 4.1). */
const bareHour = (hour: number): number => (hour > 12 ? hour - 12 : hour);

const relative = (amount: number, unit: DurationUnit): string =>
  `in ${String(amount)} ${unit}${amount === 1 ? '' : 's'}`;

/** Prints a valid Time_Expression as one lowercase line (Requirement 4.1). */
export function printTimeExpression(expr: TimeExpression): string {
  if (expr.kind === 'relative') return relative(expr.amount, expr.unit);
  const parts: string[] = [];
  if (expr.day !== null) parts.push(expr.day);
  if (expr.period !== null) parts.push(expr.period);
  if (expr.kind === 'clock') {
    const hour = expr.period === null ? expr.hour : bareHour(expr.hour);
    parts.push(clock(hour, expr.minute));
  }
  return parts.join(' ');
}

/** True exactly for the values the Time_Parser can return (Requirement 4.4). */
export function isValidTimeExpression(expr: TimeExpression): boolean {
  switch (expr.kind) {
    case 'relative':
      return isIntIn(expr.amount, 1, MAX_AMOUNT) && UNITS.includes(expr.unit);
    case 'period':
      return isDay(expr.day) && isPeriod(expr.period);
    case 'clock': {
      if (!isDay(expr.day) || !isIntIn(expr.hour, 0, 23) || !isIntIn(expr.minute, 0, 59)) return false;
      if (expr.period === null) return true;
      if (!isPeriod(expr.period)) return false;
      const [min, max] = PERIOD_HOURS[expr.period];
      return expr.hour >= min && expr.hour <= max;
    }
    default:
      return false;
  }
}
