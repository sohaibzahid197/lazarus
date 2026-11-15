import { describe, expect, it } from 'vitest';
import {
  RATE_RETENTION_MS,
  checkRate,
  countInWindow,
  pruneRate,
  slowDownDue,
} from './gateway.rate.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Feeds receive times through the Rate_Limiter; records only accepted times (Requirement 5.1, 5.2). */
function run(
  receiveTimes: readonly number[],
  limit: number,
  windowMs: number,
): { accepted: boolean[]; records: number[] } {
  const records: number[] = [];
  const accepted = receiveTimes.map((t) => {
    const ok = checkRate(records, t, limit, windowMs).accepted;
    if (ok) records.push(t);
    return ok;
  });
  return { accepted, records };
}

describe('Rate_Limiter boundaries (Requirement 18.8)', () => {
  const t0 = 1_000 * HOUR;

  it.each([1, 5, 60])('accepts message %i of limit and rejects message limit + 1 in one window', (limit) => {
    const times = Array.from({ length: limit + 1 }, (_, i) => t0 + i * MINUTE);
    const windowMs = (limit + 1) * MINUTE;
    const { accepted, records } = run(times, limit, windowMs);
    expect(accepted.slice(0, limit)).toEqual(Array(limit).fill(true));
    expect(accepted[limit]).toBe(false);
    expect(records).toEqual(times.slice(0, limit));
  });

  it('leaves records unchanged when a message is rejected (Requirement 5.2)', () => {
    const { records } = run([t0, t0, t0, t0], 2, HOUR);
    expect(records).toEqual([t0, t0]);
  });

  it('accepts again at the first receive time outside the oldest accepted message window', () => {
    const limit = 5;
    const windowMs = 60 * MINUTE;
    const burst = Array.from({ length: limit }, (_, i) => t0 + i * MINUTE);
    const { records } = run(burst, limit, windowMs);
    const firstFree = t0 + windowMs;
    expect(checkRate(records, firstFree - 1, limit, windowMs).accepted).toBe(false);
    expect(checkRate(records, firstFree, limit, windowMs).accepted).toBe(true);
    expect(countInWindow(records, firstFree, windowMs)).toBe(limit - 1);
  });

  it('applies the same boundary for the 1-minute and 1440-minute windows (Requirement 5.10)', () => {
    for (const windowMs of [1 * MINUTE, 1440 * MINUTE]) {
      const { records } = run([t0], 1, windowMs);
      expect(checkRate(records, t0 + windowMs - 1, 1, windowMs).accepted).toBe(false);
      expect(checkRate(records, t0 + windowMs, 1, windowMs).accepted).toBe(true);
    }
  });
});

describe('pruneRate keeps records relevant to a 1440-minute window', () => {
  const windowMs = 1440 * MINUTE;
  const t = 2_000 * HOUR;

  it('retention equals the largest Rate_Window', () => {
    expect(RATE_RETENTION_MS).toBe(windowMs);
  });

  it('drops the record exactly 1440 minutes old and keeps one 1 ms younger', () => {
    const records = [t - windowMs - 1, t - windowMs, t - windowMs + 1, t - HOUR];
    expect(pruneRate(records, t)).toEqual([t - windowMs + 1, t - HOUR]);
  });

  it('gives the same rate decision before and after pruning', () => {
    const records = [t - windowMs - 5, t - windowMs, t - windowMs + 1, t - 1];
    const pruned = pruneRate(records, t);
    for (const limit of [1, 2, 3, 4]) {
      expect(checkRate(pruned, t, limit, windowMs)).toEqual(checkRate(records, t, limit, windowMs));
    }
    expect(countInWindow(pruned, t, windowMs)).toBe(2);
  });
});

describe('slowDownDue allows one Slow_Down_Text per window (Requirement 5.3, 5.4)', () => {
  const t = 10 * HOUR;

  it('is due with no earlier Slow_Down_Text or one exactly a window old', () => {
    expect(slowDownDue(undefined, t, HOUR)).toBe(true);
    expect(slowDownDue(t - HOUR, t, HOUR)).toBe(true);
  });

  it('is not due when the last Slow_Down_Text is inside the window', () => {
    expect(slowDownDue(t - HOUR + 1, t, HOUR)).toBe(false);
    expect(slowDownDue(t, t, HOUR)).toBe(false);
  });
});
