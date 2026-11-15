/** Rate_Limiter rules (Requirement 5.1–5.4, 5.10). Pure functions; times are epoch milliseconds. */

/** The largest Rate_Window (1440 minutes). Records older than this are never relevant. */
export const RATE_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface RateCheck {
  readonly accepted: boolean;
}

/** Number of accepted times τ with `t − windowMs < τ ≤ t`. */
export function countInWindow(times: readonly number[], t: number, windowMs: number): number {
  const start = t - windowMs;
  return times.filter((tau) => tau > start && tau <= t).length;
}

/** Accept when fewer than `limit` accepted times fall in `(t − windowMs, t]` (Requirement 5.1, 5.2). */
export function checkRate(
  times: readonly number[],
  t: number,
  limit: number,
  windowMs: number,
): RateCheck {
  return { accepted: countInWindow(times, t, windowMs) < limit };
}

/**
 * True when no Slow_Down_Text was sent for a receive time `> t − windowMs`
 * (Requirement 5.3, 5.4). `last` is the receive time of the last Slow_Down_Text, if any.
 */
export function slowDownDue(last: number | undefined, t: number, windowMs: number): boolean {
  return last === undefined || last <= t - windowMs;
}

/** Drops times older than 24 hours before `t`, keeping τ with `τ > t − 24h` (Requirement 5.10). */
export function pruneRate(times: readonly number[], t: number): readonly number[] {
  const cutoff = t - RATE_RETENTION_MS;
  return times.filter((tau) => tau > cutoff);
}
