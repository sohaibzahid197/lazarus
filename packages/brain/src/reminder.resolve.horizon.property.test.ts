// Property test for the Due_Time_Resolver horizon invariant (sms-reminders
// Requirement 3.8). Every receive time is an explicit integer; nothing reads
// the real clock.
import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { DAY_MS, pkDayStart } from './reminder.clock.js';
import { resolveDueTime } from './reminder.resolve.js';
import { REMINDER_HORIZON_MS } from './reminder.types.js';
import { REMINDER_PBT_OPTIONS, receiveTime, timeExpression } from './reminder.arbitraries.js';

const MAX_RECEIVE_TIME = 4_102_444_800_000;

/** Small offsets around a Pakistan_Time midnight, in ms (negative is the day before). */
const boundaryOffset: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(-1, 0, 1, 59_999, 60_000, 60_001, DAY_MS - 60_000, DAY_MS - 1),
  fc.integer({ min: -120_000, max: 120_000 }),
);

/** A receive time a few ms or minutes from a Pakistan_Time day start, kept in range. */
const nearPkDayBoundary: fc.Arbitrary<number> = fc
  .tuple(receiveTime, boundaryOffset)
  .map(([t, offset]) => Math.min(MAX_RECEIVE_TIME, Math.max(0, pkDayStart(t) + offset)));

/** Uniform receive times plus times biased to Pakistan_Time day boundaries. */
const anyReceiveTime: fc.Arbitrary<number> = fc.oneof(receiveTime, nearPkDayBoundary);

describe('resolveDueTime horizon', () => {
  // Feature: sms-reminders, Property 12: Due_Time is in the future and within 30 days
  // **Validates: Requirements 3.8**
  it('3.8 Due_Time is later than the receive time and within 30 days', () => {
    fc.assert(
      fc.property(timeExpression, anyReceiveTime, (expr, t) => {
        const r = resolveDueTime(expr, t);
        return (
          !r.ok ||
          (Number.isInteger(r.dueAt) && r.dueAt > t && r.dueAt - t <= REMINDER_HORIZON_MS)
        );
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
