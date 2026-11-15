// Property test for the Due_Time_Resolver wall-clock rules (sms-reminders
// Requirements 3.1–3.4, 3.6, 3.11). The oracle is independent of
// reminder.clock.ts: it reads Pakistan_Time fields with JS `Date` UTC getters
// on `t + 18,000,000` and builds expected instants with `Date.UTC`.
// Every receive time is an explicit integer; nothing reads the real clock.
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { resolveDueTime } from './reminder.resolve.js';
import type { DayPeriod, TimeExpression } from './reminder.types.js';
import { REMINDER_PBT_OPTIONS, receiveTime, timeExpression } from './reminder.arbitraries.js';

type WallExpression = Exclude<TimeExpression, { kind: 'relative' }>;

const PKT_OFFSET = 18_000_000;
const MAX_RECEIVE_TIME = 4_102_444_800_000;

/** Default times of a Day_Period used alone (Requirement 2). */
const PERIOD_DEFAULT: Readonly<Record<DayPeriod, readonly [number, number]>> = {
  morning: [9, 0],
  evening: [18, 0],
  night: [21, 0],
};

const isWall = (e: TimeExpression): e is WallExpression => e.kind !== 'relative';
const wallExpression: fc.Arbitrary<WallExpression> = timeExpression.filter(isWall);

/** Target Pakistan_Time hour and minute of a clock or period expression. */
function target(expr: WallExpression): readonly [number, number] {
  return expr.kind === 'clock' ? [expr.hour, expr.minute] : PERIOD_DEFAULT[expr.period];
}

/** Pakistan_Time calendar date of instant `t`, via `Date` UTC getters. */
function pkDate(t: number): { y: number; m: number; d: number } {
  const w = new Date(t + PKT_OFFSET);
  return { y: w.getUTCFullYear(), m: w.getUTCMonth(), d: w.getUTCDate() };
}

/** UTC instant of Pakistan_Time `h:mi:00.000` on the PKT day `dayShift` days after that of `t`. */
function pkInstant(t: number, dayShift: number, h: number, mi: number): number {
  const { y, m, d } = pkDate(t);
  return Date.UTC(y, m, d + dayShift, h, mi, 0, 0) - PKT_OFFSET;
}

const clamp = (t: number): number => Math.min(MAX_RECEIVE_TIME, Math.max(0, t));

const smallOffset: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(-60_001, -60_000, -59_999, -1, 0, 1, 59_999, 60_000, 60_001),
  fc.integer({ min: -180_000, max: 180_000 }),
);

/** Receive times near a Pakistan_Time midnight. */
const nearPkMidnight: fc.Arbitrary<number> = fc
  .tuple(receiveTime, smallOffset)
  .map(([t, off]) => clamp(pkInstant(t, 0, 0, 0) + off));

/** Receive times near the expression's target minute on some Pakistan_Time day. */
const nearTarget = (expr: WallExpression): fc.Arbitrary<number> =>
  fc.tuple(receiveTime, smallOffset).map(([t, off]) => {
    const [h, mi] = target(expr);
    return clamp(pkInstant(t, 0, h, mi) + off);
  });

const exprAndTime: fc.Arbitrary<readonly [WallExpression, number]> = wallExpression.chain((expr) =>
  fc.tuple(fc.constant(expr), fc.oneof(receiveTime, nearPkMidnight, nearTarget(expr))),
);

/** Pakistan_Time hour, minute, second and ms of `d` read with `Date`. */
function pkFields(d: number): readonly [number, number, number, number] {
  const w = new Date(d + PKT_OFFSET);
  return [w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds(), w.getUTCMilliseconds()];
}

describe('resolveDueTime wall clock', () => {
  // Feature: sms-reminders, Property 14: Clock and period times land on the right Pakistan_Time day and minute
  // **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 3.11**
  it('3.11 clock and period times land on the right Pakistan_Time day and minute', () => {
    fc.assert(
      fc.property(exprAndTime, ([expr, t]) => {
        const [h, mi] = target(expr);
        const sameDay = pkInstant(t, 0, h, mi);
        const nextDay = pkInstant(t, 1, h, mi);
        const r = resolveDueTime(expr, t);

        if (expr.day === 'today' && sameDay <= t) {
          expect(r).toEqual({ ok: false, error: 'past' });
          return;
        }
        expect(r.ok).toBe(true);
        if (!r.ok) return;

        // 3.1, 3.6, 3.11: hour and minute of the expression, seconds and ms 0.
        expect(pkFields(r.dueAt)).toEqual([h, mi, 0, 0]);

        // 3.2, 3.3, 3.4: the Pakistan_Time day chosen by the Day_Word.
        if (expr.day === 'tomorrow') {
          expect(pkDate(r.dueAt)).toEqual(pkDate(nextDay));
          expect(r.dueAt).toBe(nextDay);
        } else if (expr.day === 'today') {
          expect(pkDate(r.dueAt)).toEqual(pkDate(t));
          expect(r.dueAt).toBe(sameDay);
        } else {
          expect(r.dueAt).toBe(sameDay > t ? sameDay : nextDay);
          expect(r.dueAt).toBeGreaterThan(t);
          expect(r.dueAt - 86_400_000).toBeLessThanOrEqual(t);
        }
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
