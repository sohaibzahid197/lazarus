// Unit tests for the Pakistan_Time clock helpers.
// _Requirements: 3.1, 3.2_
import { describe, it, expect } from 'vitest';
import { DAY_MS, pkDayStart, pkWallClock } from './reminder.clock.js';

// 2025-01-14T19:00:00.000Z is 2025-01-15 00:00:00.000 Pakistan_Time.
const JAN_15_PK_START = Date.UTC(2025, 0, 14, 19, 0, 0, 0);
const JAN_14_PK_START = JAN_15_PK_START - DAY_MS;

describe('pkDayStart', () => {
  it('maps 18:59:59.999Z to the start of the same Pakistan_Time day (19:00Z the UTC day before)', () => {
    const t = Date.UTC(2025, 0, 14, 18, 59, 59, 999);
    expect(pkDayStart(t)).toBe(JAN_14_PK_START);
  });

  it('maps 19:00:00.000Z to the start of the next Pakistan_Time day', () => {
    const t = Date.UTC(2025, 0, 14, 19, 0, 0, 0);
    expect(pkDayStart(t)).toBe(JAN_15_PK_START);
  });
});

describe('pkWallClock', () => {
  it('shows 2025-01-15T05:00:00Z as 10:00 on 15 January', () => {
    const t = Date.UTC(2025, 0, 15, 5, 0, 0, 0);
    expect(pkWallClock(t)).toEqual({ hour: 10, minute: 0, day: 15, month: 1 });
  });
});
