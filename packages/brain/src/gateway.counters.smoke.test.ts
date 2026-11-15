import { describe, expect, it } from 'vitest';
import {
  countersFor,
  localDayKey,
  recordFinal,
  releaseParts,
  reserveParts,
  zeroCounters,
} from './gateway.counters.js';

describe('gateway.counters smoke', () => {
  it('computes the local day key with the offset', () => {
    const t = Date.UTC(2024, 0, 31, 20, 0); // 20:00 UTC
    expect(localDayKey(t, 0)).toBe('2024-01-31');
    expect(localDayKey(t, 300)).toBe('2024-02-01'); // UTC+5 -> 01:00 next day
    expect(localDayKey(Date.UTC(2024, 0, 1, 2, 0), -300)).toBe('2023-12-31');
  });

  it('zeroes counters on a new day', () => {
    const c = reserveParts(zeroCounters('2024-01-01'), '2024-01-01', 3);
    expect(countersFor(c, '2024-01-01')).toBe(c);
    expect(countersFor(c, '2024-01-02')).toEqual(zeroCounters('2024-01-02'));
  });

  it('reserves and releases handed parts, never below 0', () => {
    const day = '2024-01-01';
    const c = reserveParts(zeroCounters(day), day, 4);
    expect(c.handed).toBe(4);
    expect(releaseParts(c, day, 3).handed).toBe(1);
    expect(releaseParts(c, day, 9).handed).toBe(0);
  });

  it('records final outcomes', () => {
    const day = '2024-01-01';
    let c = zeroCounters(day);
    c = recordFinal(c, day, 'replied', 2);
    c = recordFinal(c, day, 'started', 1);
    c = recordFinal(c, day, 'ignored-stopped', 0);
    c = recordFinal(c, day, 'send-failed', 1);
    expect(c).toEqual({
      dayKey: day,
      received: 4,
      repliesSent: 2,
      replied: 1,
      partsSent: 4,
      ignored: 1,
      handed: 0,
    });
    expect(recordFinal(c, '2024-01-02', 'stopped', 0)).toEqual({
      ...zeroCounters('2024-01-02'),
      received: 1,
    });
  });
});
