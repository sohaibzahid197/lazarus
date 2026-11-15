/**
 * Pakistan_Time clock arithmetic (Requirements 3.1, 3.2).
 *
 * Pakistan_Time is a fixed UTC+05:00 with no daylight saving time, so every
 * conversion is plain integer arithmetic on epoch milliseconds. Nothing here
 * creates a `Date`, reads the system clock or depends on the process time zone.
 */

import type { Language } from './router.types.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import { PK_OFFSET_MS } from './reminder.types.js';


/** One day in milliseconds. */
export const DAY_MS = 86_400_000;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Wall-clock fields of a moment in Pakistan_Time. */
export interface PkWallClock {
  /** 0 to 23. */
  readonly hour: number;
  /** 0 to 59. */
  readonly minute: number;
  /** Day of month, 1 to 31. */
  readonly day: number;
  /** Month, 1 (January) to 12 (December). */
  readonly month: number;
}

/**
 * Start (00:00:00.000 Pakistan_Time) of the Pakistan_Time day containing `t`,
 * as epoch milliseconds. That is 19:00:00.000 UTC of the previous UTC day (3.2).
 */
export const pkDayStart = (t: number): number =>
  Math.floor((t + PK_OFFSET_MS) / DAY_MS) * DAY_MS - PK_OFFSET_MS;

/** Wall-clock hour, minute, day of month and month of `t` in Pakistan_Time (3.1). */
export function pkWallClock(t: number): PkWallClock {
  const local = t + PK_OFFSET_MS;
  const days = Math.floor(local / DAY_MS);
  const msOfDay = local - days * DAY_MS;
  const { day, month } = civilFromDays(days);
  return {
    hour: Math.floor(msOfDay / HOUR_MS),
    minute: Math.floor((msOfDay % HOUR_MS) / MINUTE_MS),
    day,
    month,
  };
}

/**
 * Proleptic Gregorian month and day for a count of days since 1970-01-01
 * (Howard Hinnant's `civil_from_days`). Integer-only and valid for negative days.
 */
function civilFromDays(daysSinceEpoch: number): { readonly day: number; readonly month: number } {
  const z = daysSinceEpoch + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1_460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365); // [0, 399]
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365], March-based
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11], 0 = March
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return { day, month };
}

/**
 * Due_Time in Pakistan_Time as `D Mon H:MM` (5.2, 6.2): day of month, the
 * Language's month name, 24-hour hour without padding and a 2-digit minute.
 * For example `5 Jan 9:05`, `31 Dec 23:59` or `5 جنوری 9:05`.
 */
export function formatWhen(dueAt: number, language: Language): string {
  const { day, month, hour, minute } = pkWallClock(dueAt);
  const name = REMINDER_TEXTS[language].months[month - 1] ?? '';
  return `${day} ${name} ${hour}:${String(minute).padStart(2, '0')}`;
}
