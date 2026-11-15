// Property test for Relative_Duration resolution (sms-reminders Requirements
// 3.5 and 3.7). Every receive time is an explicit integer; nothing reads the
// real clock.
import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { resolveDueTime } from './reminder.resolve.js';
import { REMINDER_HORIZON_MS, type DurationUnit } from './reminder.types.js';
import { REMINDER_PBT_OPTIONS, receiveTime } from './reminder.arbitraries.js';

/** Milliseconds per unit, written out here so the test does not reuse the resolver's table. */
const UNIT_MS: Readonly<Record<DurationUnit, number>> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

const MAX_AMOUNT = 999_999;

/** Largest amount of `unit` still inside the horizon: 43,200 min, 720 h, 30 days. */
const horizonAmount = (unit: DurationUnit): number => REMINDER_HORIZON_MS / UNIT_MS[unit];

/** Amounts 1 to 999,999, biased to small values and to both sides of the horizon. */
function amountFor(unit: DurationUnit): fc.Arbitrary<number> {
  const limit = horizonAmount(unit);
  return fc.oneof(
    fc.integer({ min: 1, max: MAX_AMOUNT }),
    fc.integer({ min: 1, max: 60 }),
    fc.constantFrom(limit, limit + 1),
    fc.integer({ min: Math.max(1, limit - 3), max: limit + 3 }),
    fc.integer({ min: 1, max: limit }),
  );
}

const relativeDuration = fc
  .constantFrom<DurationUnit>('minute', 'hour', 'day')
  .chain((unit) => fc.record({ unit: fc.constant(unit), amount: amountFor(unit) }));

describe('resolveDueTime relative durations', () => {
  // Feature: sms-reminders, Property 15: Relative durations add exactly
  // **Validates: Requirements 3.5, 3.7**
  it('3.5, 3.7 a Relative_Duration adds exactly N units, or is too-far past 30 days', () => {
    fc.assert(
      fc.property(relativeDuration, receiveTime, ({ amount, unit }, t) => {
        const r = resolveDueTime({ kind: 'relative', amount, unit }, t);
        const delta = amount * UNIT_MS[unit];
        if (delta <= REMINDER_HORIZON_MS) return r.ok && r.dueAt === t + delta;
        return !r.ok && r.error === 'too-far';
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
