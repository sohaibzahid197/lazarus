// Day counters for the Main_Screen and the Daily_Send_Cap
// (necromancer-sms-gateway design, "Rate and cap rules" and "Send finalization").
// Pure functions: every call returns a new DayCounters value.
import type { DayCounters, Outcome } from './gateway.types.js';

const MS_PER_MINUTE = 60_000;

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/**
 * Local calendar day of `ms` as 'YYYY-MM-DD'. `tzOffsetMinutes` is the local
 * offset east of UTC (local = UTC + offset), e.g. 300 for Pakistan (UTC+5).
 * Requirement 5.13: the day rolls over at 00:00 local time.
 */
export function localDayKey(ms: number, tzOffsetMinutes: number): string {
  const local = new Date(ms + tzOffsetMinutes * MS_PER_MINUTE);
  return `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1, 2)}-${pad(local.getUTCDate(), 2)}`;
}

/** All-zero counters for `dayKey`. */
export function zeroCounters(dayKey: string): DayCounters {
  return { dayKey, received: 0, repliesSent: 0, replied: 0, partsSent: 0, ignored: 0, handed: 0 };
}

/** Counters that apply on `today`: the stored ones, or zero counters on a new day (Requirement 5.13). */
export function countersFor(c: DayCounters, today: string): DayCounters {
  return c.dayKey === today ? c : zeroCounters(today);
}

/** Records `n` parts handed to the Sms_Sender today (Daily_Send_Cap basis, Requirement 5.8). */
export function reserveParts(c: DayCounters, today: string, n: number): DayCounters {
  const cur = countersFor(c, today);
  return { ...cur, handed: cur.handed + Math.max(0, n) };
}

/** Gives back `n` reserved parts that were never sent (refused or cancelled); never below 0. */
export function releaseParts(c: DayCounters, today: string, n: number): DayCounters {
  const cur = countersFor(c, today);
  return { ...cur, handed: Math.max(0, cur.handed - Math.max(0, n)) };
}

/**
 * Counts one Inbound_Message with its Final_Outcome and the parts reported 'sent'.
 * Requirements 9.2, 13.12.
 */
export function recordFinal(
  c: DayCounters,
  today: string,
  outcome: Outcome,
  partsSent: number,
): DayCounters {
  const cur = countersFor(c, today);
  const isReply = outcome === 'replied' || outcome === 'started';
  return {
    ...cur,
    received: cur.received + 1,
    repliesSent: cur.repliesSent + (isReply ? 1 : 0),
    replied: cur.replied + (outcome === 'replied' ? 1 : 0),
    partsSent: cur.partsSent + Math.max(0, partsSent),
    ignored: cur.ignored + (outcome.startsWith('ignored-') ? 1 : 0),
  };
}
