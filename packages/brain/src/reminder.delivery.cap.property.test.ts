// Feature: sms-reminders, Property 32: A run of due reminders never exceeds the cap
// **Validates: Requirements 10.11, 11.4, 11.14**
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { decideDelivery, finalizeDelivery } from './reminder.delivery.js';
import { dueReminders } from './reminder.store.js';
import { applyChanges } from './gateway.pipeline.js';
import { countersFor } from './gateway.counters.js';
import { LATE_WINDOW_MS } from './reminder.types.js';
import type { Reminder, ReminderState } from './reminder.types.js';
import type { GatewayState, PartResult, SendReport } from './gateway.types.js';
import { REMINDER_PBT_OPTIONS, reminderStore } from './reminder.arbitraries.js';
import { canonicalNumber, dayKeyArb, gatewayState, timeArb } from './gateway.arbitraries.js';

const PART_RESULTS: readonly PartResult[] = ['sent', 'failed-radio', 'failed-no-service', 'failed-other'];

/** A report template; `reportFor` trims its results to the actual part count. */
const reportTemplate = fc.oneof(
  {
    arbitrary: fc.record({
      status: fc.constant('done' as const),
      results: fc.array(fc.constantFrom(...PART_RESULTS), { minLength: 4, maxLength: 4 }),
      attempts: fc.constantFrom<1 | 2>(1, 2),
    }),
    weight: 4,
  },
  { arbitrary: fc.constant({ status: 'refused-stopped' as const }), weight: 1 },
  { arbitrary: fc.constant({ status: 'cancelled' as const }), weight: 1 },
);
type ReportTemplate = typeof reportTemplate extends fc.Arbitrary<infer T> ? T : never;

const reportFor = (t: ReportTemplate, partCount: number): SendReport =>
  t.status === 'done' ? { ...t, results: t.results.slice(0, partCount) } : t;

const remindersOf = (s: ReminderState): readonly Reminder[] =>
  s.status === 'ok' ? s.reminders : [];

/** Offsets before `now`: ties, inside the Late_Window, past it, and a few not yet due. */
const offset = fc.oneof(
  fc.constantFrom(0, 1, 60_000),
  fc.integer({ min: 0, max: LATE_WINDOW_MS }),
  fc.integer({ min: LATE_WINDOW_MS + 1, max: 2 * LATE_WINDOW_MS }),
  fc.integer({ min: -LATE_WINDOW_MS, max: -1 }),
);

/**
 * A Gateway_State with a small Daily_Send_Cap (1–10), many reminders clustered
 * around `now`, and list numbers shared with the reminders' numbers.
 */
const scenario = fc
  .uniqueArray(canonicalNumber, { minLength: 1, maxLength: 4 })
  .chain((pool) => gatewayState(pool, reminderStore(pool)))
  .chain((state) => {
    const n = remindersOf(state.reminders).length;
    return fc.record({
      state: fc.constant(state),
      now: timeArb,
      cap: fc.integer({ min: 1, max: 10 }),
      handedFrac: fc.double({ min: 0, max: 1, noNaN: true }),
      offsets: fc.array(offset, { minLength: n, maxLength: n }),
      sameDay: fc.boolean(),
      otherDay: dayKeyArb,
      reports: fc.array(reportTemplate, { minLength: n, maxLength: n }),
    });
  })
  .map(({ state, now, cap, handedFrac, offsets, sameDay, otherDay, reports }) => {
    const reminders = remindersOf(state.reminders).map((r, i): Reminder => {
      const dueAt = now - (offsets[i] ?? 0);
      return { ...r, dueAt, handedAt: r.handedAt === null ? null : dueAt };
    });
    const s: GatewayState = {
      ...state,
      settings: { ...state.settings, dailySendCap: cap },
      counters: { ...state.counters, handed: Math.floor(handedFrac * cap) },
      reminders: { status: 'ok', reminders },
    };
    return { state: s, now, today: sameDay ? s.counters.dayKey : otherDay, reports };
  });

const byDueThenId = (a: Reminder, b: Reminder): number =>
  a.dueAt - b.dueAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

describe('Property 32: A run of due reminders never exceeds the cap', () => {
  it('10.11 folding decideDelivery over due reminders keeps handed <= cap and gives one outcome each', () => {
    fc.assert(
      fc.property(scenario, ({ state, now, today, reports }) => {
        const cap = state.settings.dailySendCap;
        const all = remindersOf(state.reminders);
        const due = dueReminders(state.reminders, now);

        // Order is ascending by (dueAt, id) and excludes handed reminders.
        const expected = all.filter((r) => r.handedAt === null && r.dueAt <= now).sort(byDueThenId);
        expect(due.map((r) => r.id)).toEqual(expected.map((r) => r.id));

        let s = state;
        const handedNow = (): number => countersFor(s.counters, today).handed;
        expect(handedNow()).toBeLessThanOrEqual(cap);
        const outcomes = new Map<string, string>();

        due.forEach((r, i) => {
          // Not yet removed and not handed when its turn comes.
          const current = remindersOf(s.reminders).find((x) => x.id === r.id);
          expect(current?.handedAt).toBeNull();

          const step = decideDelivery(r, s, now, today);
          expect(step.kind).not.toBe('wait');
          if (step.kind === 'wait') return;
          s = applyChanges(s, step.changes);
          expect(handedNow()).toBeLessThanOrEqual(cap);

          if (step.kind === 'final') {
            outcomes.set(r.id, step.outcome);
          } else {
            // Handed exactly once: a second decision of the marked reminder is not a due one.
            expect(dueReminders(s.reminders, now).some((x) => x.id === r.id)).toBe(false);
            const template = reports[i];
            if (template === undefined) throw new Error('missing report');
            const fin = finalizeDelivery(
              r,
              step.parts.length,
              reportFor(template, step.parts.length),
              s.counters,
              today,
            );
            s = applyChanges(s, fin.changes);
            expect(handedNow()).toBeLessThanOrEqual(cap);
            outcomes.set(r.id, fin.outcome);
          }
          // The outcome removes the reminder.
          expect(remindersOf(s.reminders).some((x) => x.id === r.id)).toBe(false);
        });

        // Exactly one outcome per due reminder; nothing due is left; other reminders untouched.
        expect(outcomes.size).toBe(due.length);
        expect(dueReminders(s.reminders, now)).toEqual([]);
        const dueIds = new Set(due.map((r) => r.id));
        expect(remindersOf(s.reminders)).toEqual(all.filter((r) => !dueIds.has(r.id)));
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
