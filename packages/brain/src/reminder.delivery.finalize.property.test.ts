// Feature: sms-reminders, Property 31: Delivery finalization accounting
// **Validates: Requirements 10.6, 10.7, 10.8**
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { decideDelivery, finalizeDelivery } from './reminder.delivery.js';
import type { DeliveryOutcome, Reminder } from './reminder.types.js';
import { countersFor } from './gateway.counters.js';
import type { DayCounters, GatewayState, SendReport, StateChange } from './gateway.types.js';
import { REMINDER_PBT_OPTIONS, reminder } from './reminder.arbitraries.js';
import { dayCounters, dayKeyArb, gatewayState, sendReport } from './gateway.arbitraries.js';

/** Parts the Sms_Sender reported `sent`; 0 for a refused or cancelled report. */
const sentParts = (report: SendReport): number =>
  report.status === 'done' ? report.results.filter((p) => p === 'sent').length : 0;

/** The outcome Property 31 requires for a report of `p` parts. */
function expectedOutcome(report: SendReport, p: number): DeliveryOutcome {
  if (report.status !== 'done') return 'reminder-stopped';
  return sentParts(report) === p ? 'reminder-sent' : 'reminder-failed';
}

function countersChange(changes: readonly StateChange[]): DayCounters {
  const found = changes.filter((c) => c.type === 'counters');
  expect(found).toHaveLength(1);
  const c = found[0];
  if (c?.type !== 'counters') throw new Error('no counters change');
  return c.counters;
}

function expectRemoved(changes: readonly StateChange[], r: Reminder): void {
  const removes = changes.filter((c) => c.type === 'reminder-remove');
  expect(removes).toEqual([{ type: 'reminder-remove', id: r.id }]);
}

/** `today` is either the counters' day or another day (fresh counters). */
const todayFor = (dayKey: string): fc.Arbitrary<string> =>
  fc.oneof(fc.constant(dayKey), dayKeyArb);

describe('Property 31: Delivery finalization accounting', () => {
  it('10.6 10.7 10.8 maps the report to one outcome, settles counters and removes the reminder', () => {
    const cases = fc
      .record({
        r: reminder,
        p: fc.integer({ min: 1, max: 4 }),
        counters: fc.integer({ min: 1, max: 2000 }).chain(dayCounters),
      })
      .chain((c) =>
        fc.record({
          c: fc.constant(c),
          report: sendReport(c.p),
          today: todayFor(c.counters.dayKey),
        }),
      );
    fc.assert(
      fc.property(cases, ({ c: { r, p, counters }, report, today }) => {
        const fin = finalizeDelivery(r, p, report, counters, today);
        const s = sentParts(report);
        const base = countersFor(counters, today);
        expect(fin.outcome).toBe(expectedOutcome(report, p));
        expectRemoved(fin.changes, r);
        expect(countersChange(fin.changes)).toEqual({
          dayKey: today,
          received: base.received,
          repliesSent: base.repliesSent,
          replied: base.replied,
          ignored: base.ignored,
          partsSent: base.partsSent + s,
          handed: Math.max(0, base.handed - (p - s)),
        });
      }),
      REMINDER_PBT_OPTIONS,
    );
  });

  it('10.6 10.7 after the decideDelivery reserve, handed and partsSent each grow by the sent parts only', () => {
    // A state where the reminder is due and nothing blocks it: no Stop_List,
    // Allowlist_Mode off, decided at the Due_Time, cap above any reservation.
    const cases = fc
      .record({ r: reminder, state: gatewayState() })
      .chain(({ r, state }) =>
        fc.record({
          r: fc.constant(r),
          state: fc.constant(state),
          today: todayFor(state.counters.dayKey),
        }),
      )
      .map(({ r, state, today }) => {
        const open: GatewayState = {
          ...state,
          stopList: new Set(),
          settings: {
            ...state.settings,
            allowlistMode: false,
            dailySendCap: state.counters.handed + 10,
          },
        };
        return { r, state: open, today };
      })
      .chain((c) => {
        const step = decideDelivery(c.r, c.state, c.r.dueAt, c.today);
        if (step.kind !== 'send') throw new Error(`expected send, got ${step.kind}`);
        return fc.record({
          c: fc.constant(c),
          parts: fc.constant(step.parts.length),
          reserved: fc.constant(countersChange(step.changes)),
          report: sendReport(step.parts.length),
        });
      });
    fc.assert(
      fc.property(cases, ({ c: { r, state, today }, parts, reserved, report }) => {
        const before = countersFor(state.counters, today);
        expect(reserved.handed).toBe(before.handed + parts);
        const fin = finalizeDelivery(r, parts, report, reserved, today);
        const s = sentParts(report);
        expect(fin.outcome).toBe(expectedOutcome(report, parts));
        expectRemoved(fin.changes, r);
        expect(countersChange(fin.changes)).toEqual({
          ...before,
          handed: before.handed + s,
          partsSent: before.partsSent + s,
        });
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
