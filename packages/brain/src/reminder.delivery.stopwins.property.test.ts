// Feature: sms-reminders, Property 25: STOP always wins for reminders
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canonicalNumber,
  dayKeyArb,
  gatewayState,
  sendReport,
  timeArb,
} from './gateway.arbitraries.js';
import { stopChanges } from './gateway.checks.js';
import { countersFor } from './gateway.counters.js';
import { applyChanges, completeReply, evaluateInbound } from './gateway.pipeline.js';
import type {
  CanonicalNumber,
  DayCounters,
  GatewayState,
  InboundMessage,
  SendReport,
  StateChange,
} from './gateway.types.js';
import { REMINDER_PBT_OPTIONS, reminder, reminderStore } from './reminder.arbitraries.js';
import { decideDelivery, finalizeDelivery } from './reminder.delivery.js';
import { reconcileOnLoad } from './reminder.store.js';
import type { Reminder, ReminderId } from './reminder.types.js';
import { routeCommand } from './router.js';
import { splitSms } from './sms.js';

/** Late_Window written out independently of the module constant. */
const LATE_MS = 3_600_000;
const MINUTE = 60_000;
const ZERO_DAY: DayCounters = {
  dayKey: '2030-01-01',
  received: 0,
  repliesSent: 0,
  replied: 0,
  partsSent: 0,
  ignored: 0,
  handed: 0,
};

/** `count` Reminders of `number` with unique ids and Due_Times in [base + lo, base + hi]. */
function remindersOf(
  number: CanonicalNumber,
  base: number,
  lo: number,
  hi: number,
): fc.Arbitrary<Reminder[]> {
  return fc
    .array(fc.tuple(reminder, fc.integer({ min: lo, max: hi })), { minLength: 1, maxLength: 5 })
    .map((rs) =>
      rs.map(([r, offset], i): Reminder => {
        const id = `r:stopwins-${String(i)}` as ReminderId;
        return { ...r, id, number, dueAt: base + offset, handedAt: null };
      }),
    );
}

/** A state whose Own_Number is not `number`, holding `own` Reminders beside random ones. */
function stateWith(number: CanonicalNumber, own: readonly Reminder[]): fc.Arbitrary<GatewayState> {
  return gatewayState([number], reminderStore([number])).map((s): GatewayState => {
    const others = s.reminders.status === 'ok' ? s.reminders.reminders : [];
    const ownNumber = s.settings.ownNumber === number ? null : s.settings.ownNumber;
    return {
      ...s,
      settings: { ...s.settings, ownNumber },
      reminders: { status: 'ok', reminders: [...others.filter((r) => r.number !== number), ...own] },
    };
  });
}

/** Asserts the STOP-wins decision for a Reminder of a Stop_List number (8.4). */
function expectStopped(r: Reminder, state: GatewayState, now: number, today: string): void {
  const step = decideDelivery(r, state, now, today);
  expect(step.kind).not.toBe('send');
  if (r.dueAt > now) {
    expect(step).toEqual({ kind: 'wait' });
    return;
  }
  expect(step).toEqual({
    kind: 'final',
    outcome: 'reminder-stopped',
    changes: [{ type: 'reminder-remove', id: r.id }],
  });
}

// ---------------------------------------------------------------------------
// Single decisions: any Gateway_State with the number on the Stop_List
// ---------------------------------------------------------------------------

interface ListedCase {
  readonly r: Reminder;
  readonly state: GatewayState;
  readonly now: number;
  readonly today: string;
}

/** The Reminder's number is on the Stop_List; allowlist, cap, counters and `now` are free. */
const listedCase: fc.Arbitrary<ListedCase> = canonicalNumber.chain((number) =>
  remindersOf(number, 0, 0, 0).chain(([seed]) =>
    fc
      .record({
        state: gatewayState([number], reminderStore([number])),
        dueAt: timeArb,
        delta: fc.oneof(
          fc.integer({ min: -2, max: 2 }),
          fc.integer({ min: LATE_MS - 2, max: LATE_MS + 2 }),
          fc.integer({ min: -2 * LATE_MS, max: 2 * LATE_MS }),
        ),
        resetHanded: fc.boolean(),
        listAllowed: fc.boolean(),
        sameDay: fc.boolean(),
        otherDay: dayKeyArb,
      })
      .map(({ state, dueAt, delta, resetHanded, listAllowed, sameDay, otherDay }): ListedCase => {
        const r: Reminder = { ...(seed as Reminder), dueAt };
        const allowlist =
          listAllowed && state.allowlist !== 'unreadable'
            ? new Set([...state.allowlist, number])
            : state.allowlist;
        const handed = resetHanded ? 0 : state.counters.handed;
        const s: GatewayState = {
          ...state,
          stopList: new Set([...state.stopList, number]),
          allowlist,
          counters: { ...state.counters, handed },
        };
        return { r, state: s, now: dueAt + delta, today: sameDay ? s.counters.dayKey : otherDay };
      }),
  ),
);

// ---------------------------------------------------------------------------
// Sequences: STOP / START / reload / delivery for one number
// ---------------------------------------------------------------------------

type Event =
  | { readonly kind: 'stop'; readonly gapMs: number; readonly paused: boolean; readonly dropRemoval: boolean }
  | { readonly kind: 'start'; readonly gapMs: number }
  | { readonly kind: 'reload'; readonly gapMs: number }
  | { readonly kind: 'deliver'; readonly gapMs: number; readonly pick: number; readonly reportSeed: number };

const gap = fc.integer({ min: 0, max: 10 * MINUTE });

const eventArb: fc.Arbitrary<Event> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant('stop' as const),
      gapMs: gap,
      paused: fc.boolean(),
      dropRemoval: fc.boolean(),
    }),
    weight: 2,
  },
  { arbitrary: fc.record({ kind: fc.constant('start' as const), gapMs: gap }), weight: 1 },
  { arbitrary: fc.record({ kind: fc.constant('reload' as const), gapMs: gap }), weight: 1 },
  {
    arbitrary: fc.record({
      kind: fc.constant('deliver' as const),
      gapMs: gap,
      pick: fc.nat(),
      reportSeed: fc.nat(),
    }),
    weight: 5,
  },
);

interface Sequence {
  readonly number: CanonicalNumber;
  readonly own: readonly Reminder[];
  readonly state: GatewayState;
  readonly start: number;
  readonly today: string;
  readonly events: readonly Event[];
}

/** Reminders due from 30 minutes before the first event to 2 hours after it. */
const sequenceArb: fc.Arbitrary<Sequence> = fc
  .tuple(canonicalNumber, timeArb)
  .chain(([number, start]) =>
    remindersOf(number, start, -30 * MINUTE, 2 * 60 * MINUTE).chain((own) =>
      fc.record({
        number: fc.constant(number),
        own: fc.constant(own),
        state: stateWith(number, own),
        start: fc.constant(start),
        sameDay: fc.boolean(),
        events: fc.array(eventArb, { minLength: 1, maxLength: 14 }),
      }),
    ),
  )
  .map(({ sameDay, ...s }): Sequence => ({ ...s, today: sameDay ? s.state.counters.dayKey : '2099-01-01' }));

/** Changes of an inbound STOP or START evaluated by the Gateway_Pipeline. */
function inboundChanges(
  body: string,
  number: CanonicalNumber,
  state: GatewayState,
  at: number,
  paused: boolean,
  today: string,
): readonly StateChange[] {
  const msg: InboundMessage = { id: `m${String(at)}`, seq: at, sender: number, body, receivedAt: at };
  const step = evaluateInbound(msg, state, { paused, today }, routeCommand, false);
  if (step.kind === 'final') return step.decision.changes;
  if (step.kind === 'reply') return completeReply(step.pending, step.text, state, splitSms).changes;
  return [];
}

/** Fits a drawn Send_Report to `partCount` parts. */
function reportFor(r: SendReport, partCount: number): SendReport {
  if (r.status !== 'done') return r;
  const results = Array.from({ length: partCount }, (_, i) => r.results[i % r.results.length] ?? 'sent');
  return { ...r, results };
}

describe('Property 25: STOP always wins for reminders', () => {
  it('8.7 decideDelivery never sends for a Stop_List number, whatever due time, allowlist, cap and counters', () => {
    // **Validates: Requirements 8.4, 8.7**
    fc.assert(
      fc.property(listedCase, ({ r, state, now, today }) => {
        expectStopped(r, state, now, today);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });

  it('8.7 a Reminder due before the STOP and still inside the Late_Window is stopped, even if its removal was dropped', () => {
    // **Validates: Requirements 8.4, 8.7**
    fc.assert(
      fc.property(
        canonicalNumber.chain((n) => remindersOf(n, 0, 0, 0).map((rs) => [n, rs] as const)),
        timeArb,
        fc.integer({ min: 0, max: LATE_MS }),
        fc.integer({ min: 0, max: LATE_MS }),
        fc.boolean(),
        ([number, own], dueAt, stopAfter, deliverAfter, dropRemoval) => {
          const r: Reminder = { ...(own[0] as Reminder), dueAt };
          const stopAt = dueAt + stopAfter;
          const now = Math.min(dueAt + LATE_MS, stopAt + deliverAfter);
          const base: GatewayState = {
            stopList: new Set(),
            allowlist: new Set(),
            rate: new Map(),
            slowDown: new Map(),
            counters: ZERO_DAY,
            settings: {
              allowlistMode: false,
              perNumberLimit: 60,
              rateWindowMinutes: 1,
              dailySendCap: 2000,
              defaultCountryCode: '92',
              ownNumber: null,
            },
            reminders: { status: 'ok', reminders: [r] },
          };
          // Without STOP this Reminder would be sent at `now`.
          expect(decideDelivery(r, base, now, '2030-01-01').kind).toBe('send');
          const changes = stopChanges(number).filter(
            (c) => !(dropRemoval && c.type === 'reminder-remove-all'),
          );
          const after = applyChanges(base, changes);
          expectStopped(r, after, now, '2030-01-01');
        },
      ),
      REMINDER_PBT_OPTIONS,
    );
  });

  it('8.7 after STOP and before START, no delivery step for any Reminder of that number sends', () => {
    // **Validates: Requirements 8.4, 8.7**
    fc.assert(
      fc.property(sequenceArb, fc.array(sendReport(), { minLength: 1, maxLength: 4 }), (sq, reports) => {
        let state = sq.state;
        let now = sq.start;
        let stopped = state.stopList.has(sq.number);
        // Delivery uses the Reminders as first loaded, so a dropped or unpersisted removal still reaches decideDelivery.
        const stale = sq.own;
        for (const ev of sq.events) {
          now += ev.gapMs;
          if (ev.kind === 'stop') {
            const changes = inboundChanges('STOP', sq.number, state, now, ev.paused, sq.today);
            expect(changes).toContainEqual({ type: 'stop-add', number: sq.number });
            state = applyChanges(
              state,
              changes.filter((c) => !(ev.dropRemoval && c.type === 'reminder-remove-all')),
            );
            stopped = true;
          } else if (ev.kind === 'start') {
            const changes = inboundChanges('START', sq.number, state, now, false, sq.today);
            state = applyChanges(state, changes);
            if (changes.some((c) => c.type === 'stop-remove' && c.number === sq.number)) stopped = false;
          } else if (ev.kind === 'reload') {
            state = applyChanges(state, reconcileOnLoad(state, now).changes);
          } else {
            const r = stale[ev.pick % stale.length] as Reminder;
            if (stopped) {
              expectStopped(r, state, now, sq.today);
            }
            const step = decideDelivery(r, state, now, sq.today);
            if (step.kind === 'final') state = applyChanges(state, step.changes);
            if (step.kind === 'send') {
              expect(stopped).toBe(false);
              const handedState = applyChanges(state, step.changes);
              const report = reportFor(reports[ev.reportSeed % reports.length], step.parts.length);
              const fin = finalizeDelivery(r, step.parts.length, report, handedState.counters, sq.today);
              state = applyChanges(handedState, fin.changes);
            }
          }
        }
      }),
      REMINDER_PBT_OPTIONS,
    );
  });

  it('8.7 a refused-stopped or cancelled send report finalizes as reminder-stopped with 0 parts sent', () => {
    // **Validates: Requirements 8.4, 8.7**
    fc.assert(
      fc.property(
        reminder,
        fc.integer({ min: 1, max: 3 }),
        fc.constantFrom({ status: 'refused-stopped' as const }, { status: 'cancelled' as const }),
        fc.record({
          dayKey: dayKeyArb,
          received: fc.nat(5000),
          repliesSent: fc.nat(5000),
          replied: fc.nat(5000),
          partsSent: fc.nat(5000),
          ignored: fc.nat(5000),
          handed: fc.nat(5000),
        }),
        fc.boolean(),
        dayKeyArb,
        (r, partCount, report, counters, sameDay, otherDay) => {
          const today = sameDay ? counters.dayKey : otherDay;
          const before = countersFor(counters, today);
          const fin = finalizeDelivery(r, partCount, report, counters, today);
          expect(fin.outcome).toBe('reminder-stopped');
          expect(fin.changes).toContainEqual({ type: 'reminder-remove', id: r.id });
          const next = fin.changes.find((c) => c.type === 'counters');
          expect(next?.type).toBe('counters');
          if (next?.type === 'counters') expect(next.counters.partsSent).toBe(before.partsSent);
        },
      ),
      REMINDER_PBT_OPTIONS,
    );
  });
});
