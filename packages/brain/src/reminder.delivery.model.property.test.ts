// Feature: sms-reminders, Property 29: Delivery_Decision matches the check-order model
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalNumber, dayKeyArb, gatewayState } from './gateway.arbitraries.js';
import type { CanonicalNumber, DayCounters, GatewayState, StateChange } from './gateway.types.js';
import { REMINDER_PBT_OPTIONS, reminder, reminderStore } from './reminder.arbitraries.js';
import { decideDelivery } from './reminder.delivery.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import type { DeliveryStep, Reminder } from './reminder.types.js';
import { splitSms } from './sms.js';

/** Late_Window written out independently of the module constant. */
const LATE_MS = 3_600_000;

/** Reply_Parts of the Reminder_Delivery_Text, computed without the module under test. */
const partsOf = (r: Reminder): string[] => splitSms(REMINDER_TEXTS[r.language].deliveryLead + r.text);

const zero = (dayKey: string): DayCounters => ({
  dayKey,
  received: 0,
  repliesSent: 0,
  replied: 0,
  partsSent: 0,
  ignored: 0,
  handed: 0,
});

/** Reference model of the check order (Requirements 10.1–10.5, 10.9, 10.13, 8.4). */
function model(r: Reminder, state: GatewayState, now: number, today: string): DeliveryStep {
  if (r.dueAt > now) return { kind: 'wait' };
  const final = (
    outcome: 'reminder-stopped' | 'reminder-not-allowed' | 'reminder-expired' | 'reminder-capped',
  ): DeliveryStep => ({ kind: 'final', outcome, changes: [{ type: 'reminder-remove', id: r.id }] });
  if (state.stopList.has(r.number)) return final('reminder-stopped');
  const { allowlistMode, dailySendCap } = state.settings;
  if (allowlistMode && (state.allowlist === 'unreadable' || !state.allowlist.has(r.number))) {
    return final('reminder-not-allowed');
  }
  if (now > r.dueAt + LATE_MS) return final('reminder-expired');
  const parts = partsOf(r);
  const base = state.counters.dayKey === today ? state.counters : zero(today);
  if (base.handed + parts.length > dailySendCap) return final('reminder-capped');
  const changes: StateChange[] = [
    { type: 'reminder-handed', id: r.id, at: now },
    { type: 'counters', counters: { ...base, handed: base.handed + parts.length } },
  ];
  return { kind: 'send', parts, changes };
}

/** `now` biased to dueAt and dueAt + Late_Window (±2 ms), else anywhere in ±2 hours. */
const nowFor = (dueAt: number): fc.Arbitrary<number> =>
  fc.oneof(
    fc.integer({ min: -2, max: 2 }).map((d) => dueAt + d),
    fc.integer({ min: -2, max: 2 }).map((d) => dueAt + LATE_MS + d),
    fc.integer({ min: -2 * LATE_MS, max: 2 * LATE_MS }).map((d) => dueAt + d),
  );

interface Case {
  readonly r: Reminder;
  readonly state: GatewayState;
  readonly now: number;
  readonly today: string;
}

/** A Reminder, a Gateway_State sharing its numbers, and `now`/`today`; counters often near the cap. */
const caseArb: fc.Arbitrary<Case> = fc
  .uniqueArray(canonicalNumber, { minLength: 1, maxLength: 3 })
  .chain((pool: readonly CanonicalNumber[]) =>
    fc.record({
      r: fc
        .tuple(reminder, fc.constantFrom(...pool), fc.boolean())
        .map(([r, n, usePool]) => (usePool ? { ...r, number: n } : r)),
      state: gatewayState(pool, reminderStore(pool)),
      delta: fc.option(fc.integer({ min: -2, max: 2 }), { nil: null, freq: 2 }),
      sameDay: fc.boolean(),
      otherDay: dayKeyArb,
    }),
  )
  .chain(({ r, state, delta, sameDay, otherDay }) => {
    const cap = state.settings.dailySendCap;
    const handed =
      delta === null ? state.counters.handed : Math.max(0, cap - partsOf(r).length + delta);
    const s: GatewayState = { ...state, counters: { ...state.counters, handed } };
    const today = sameDay ? s.counters.dayKey : otherDay;
    return nowFor(r.dueAt).map((now): Case => ({ r, state: s, now, today }));
  });

const snapshot = (s: GatewayState): string =>
  JSON.stringify({ rate: [...s.rate], slowDown: [...s.slowDown] });

describe('Property 29: Delivery_Decision matches the check-order model', () => {
  it('10.1 decideDelivery equals the check-order model and leaves rate and slowDown unchanged', () => {
    // **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.9, 10.13, 8.4**
    fc.assert(
      fc.property(caseArb, ({ r, state, now, today }) => {
        const before = snapshot(state);
        const step = decideDelivery(r, state, now, today);
        expect(step).toEqual(model(r, state, now, today));
        expect(snapshot(state)).toBe(before);
        if (step.kind !== 'wait') {
          for (const c of step.changes) expect(['reminder-remove', 'reminder-handed', 'counters']).toContain(c.type);
        }
      }),
      REMINDER_PBT_OPTIONS,
    );
  });

  it('10.3 now = dueAt + Late_Window with handed + parts = cap gives send', () => {
    // **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.9, 10.13, 8.4**
    fc.assert(
      fc.property(caseArb, ({ r, state, today }) => {
        const parts = partsOf(r).length;
        const cap = Math.max(state.settings.dailySendCap, parts);
        const s: GatewayState = {
          ...state,
          stopList: new Set([...state.stopList].filter((n) => n !== r.number)),
          settings: { ...state.settings, allowlistMode: false, dailySendCap: cap },
          counters: { ...state.counters, dayKey: today, handed: cap - parts },
        };
        const step = decideDelivery(r, s, r.dueAt + LATE_MS, today);
        expect(step.kind).toBe('send');
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
