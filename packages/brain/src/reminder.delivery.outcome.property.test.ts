// Feature: sms-reminders, Property 30: Exactly one Delivery_Outcome
// **Validates: Requirements 10.10**
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { decideDelivery, finalizeDelivery } from './reminder.delivery.js';
import { DELIVERY_OUTCOMES, LATE_WINDOW_MS } from './reminder.types.js';
import type { Reminder } from './reminder.types.js';
import type { StateChange } from './gateway.types.js';
import { REMINDER_PBT_OPTIONS, reminder } from './reminder.arbitraries.js';
import { dayKeyArb, gatewayState, sendReport } from './gateway.arbitraries.js';

const FINAL_OUTCOMES = [
  'reminder-stopped',
  'reminder-not-allowed',
  'reminder-expired',
  'reminder-capped',
] as const;

const removals = (changes: readonly StateChange[], r: Reminder): number =>
  changes.filter((c) => c.type === 'reminder-remove' && c.id === r.id).length;

/**
 * A Reminder plus a Gateway_State. One third of states draw list numbers from
 * the reminder's number (reaching stopped / not-allowed); the rest use random
 * numbers so the send path and finalization are well covered.
 */
const reminderAndState = reminder.chain((r) =>
  fc.record({
    r: fc.constant(r),
    state: fc.oneof(
      { arbitrary: gatewayState([r.number]), weight: 1 },
      { arbitrary: gatewayState(), weight: 2 },
    ),
  }),
);

/** `today` is either the counters' day or another day (fresh counters). */
const todayFor = (dayKey: string): fc.Arbitrary<string> =>
  fc.oneof(fc.constant(dayKey), dayKeyArb);

describe('Property 30: Exactly one Delivery_Outcome', () => {
  it('10.10 a due Reminder gets exactly one Delivery_Outcome and one reminder-remove', () => {
    const due = reminderAndState.chain(({ r, state }) =>
      fc.record({
        r: fc.constant(r),
        state: fc.constant(state),
        // From the Due_Time up to well past the Late_Window.
        now: fc.integer({ min: r.dueAt, max: r.dueAt + 2 * LATE_WINDOW_MS }),
        today: todayFor(state.counters.dayKey),
      }),
    );
    // Any Send_Report for the parts the decision would send (none needed otherwise).
    const cases = due.chain((c) => {
      const step = decideDelivery(c.r, c.state, c.now, c.today);
      const partCount = step.kind === 'send' ? step.parts.length : 0;
      return fc.record({ c: fc.constant(c), report: sendReport(Math.max(partCount, 1)) });
    });
    fc.assert(
      fc.property(cases, ({ c: { r, state, now, today }, report }) => {
        const step = decideDelivery(r, state, now, today);
        expect(step.kind).not.toBe('wait');
        if (step.kind === 'final') {
          expect(FINAL_OUTCOMES).toContain(step.outcome);
          expect(removals(step.changes, r)).toBe(1);
          return;
        }
        if (step.kind !== 'send') throw new Error('unexpected step kind');
        expect(step.parts.length).toBeGreaterThanOrEqual(1);
        expect(removals(step.changes, r)).toBe(0);
        const counters = step.changes.find((c) => c.type === 'counters');
        if (counters?.type !== 'counters') throw new Error('send step has no counters change');
        const fin = finalizeDelivery(r, step.parts.length, report, counters.counters, today);
        expect(DELIVERY_OUTCOMES).toContain(fin.outcome);
        expect(removals(fin.changes, r)).toBe(1);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });

  it('10.10 a Reminder not yet due gets no Delivery_Outcome and no change', () => {
    const waiting = reminderAndState.chain(({ r, state }) =>
      fc.record({
        r: fc.constant(r),
        state: fc.constant(state),
        now: fc.integer({ min: r.dueAt - 2 * LATE_WINDOW_MS, max: r.dueAt - 1 }),
        today: todayFor(state.counters.dayKey),
      }),
    );
    fc.assert(
      fc.property(waiting, ({ r, state, now, today }) => {
        expect(decideDelivery(r, state, now, today)).toEqual({ kind: 'wait' });
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
