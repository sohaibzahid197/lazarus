import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { anyBody, canonicalNumber, settings, stopAliasBody, timeArb } from './gateway.arbitraries.js';
import { applyChanges, completeReply, evaluateInbound } from './gateway.pipeline.js';
import type {
  CanonicalNumber,
  GatewayDecision,
  GatewaySettings,
  GatewayState,
  InboundMessage,
} from './gateway.types.js';
import {
  REMINDER_PBT_OPTIONS,
  printableReminderText,
  reminderStore,
  timeExpression,
} from './reminder.arbitraries.js';
import { printTimeExpression } from './reminder.print.js';
import { EMPTY_REMINDERS, REMINDER_LIMIT, type ReminderState } from './reminder.types.js';
import { routeCommand } from './router.js';
import { splitSms } from './sms.js';

const MAX_STEP_MS = 2 * 60 * 60 * 1000;

/** A relative Time_Expression of 1 to 120 minutes: always in range, so most REMINDs succeed. */
const nearTime: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 120 })
  .map((n) => printTimeExpression({ kind: 'relative', amount: n, unit: 'minute' }));

const remindBody: fc.Arbitrary<string> = fc
  .tuple(
    fc.oneof({ arbitrary: nearTime, weight: 3 }, { arbitrary: timeExpression.map(printTimeExpression), weight: 1 }),
    printableReminderText,
  )
  .map(([when, text]) => `REMIND ${when} ${text}`);

const cancelBody: fc.Arbitrary<string> = fc.integer({ min: 0, max: 7 }).map((n) => `CANCEL ${String(n)}`);

/** REMIND weighted up so numbers often reach the Reminder_Limit. */
const bodyArb: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: remindBody, weight: 8 },
  { arbitrary: cancelBody, weight: 2 },
  { arbitrary: fc.constant('LIST'), weight: 1 },
  { arbitrary: fc.oneof(fc.constant('STOP'), stopAliasBody), weight: 1 },
  { arbitrary: fc.constant('START'), weight: 1 },
  { arbitrary: anyBody, weight: 1 },
);

const permissive: fc.Arbitrary<GatewaySettings> = fc.record({
  allowlistMode: fc.constant(false),
  perNumberLimit: fc.constant(60),
  rateWindowMinutes: fc.integer({ min: 1, max: 1440 }),
  dailySendCap: fc.constant(2000),
  defaultCountryCode: fc.constant('92'),
  ownNumber: fc.constant(null),
});

const scenario = fc.uniqueArray(canonicalNumber, { minLength: 1, maxLength: 3 }).chain((pool) =>
  fc.record({
    pool: fc.constant(pool),
    settings: fc.oneof({ arbitrary: permissive, weight: 4 }, { arbitrary: settings, weight: 1 }),
    reminders: fc.oneof(fc.constant(EMPTY_REMINDERS), reminderStore(pool)),
    start: timeArb,
    steps: fc.array(
      fc.record({
        from: fc.constantFrom(...pool),
        body: bodyArb,
        gap: fc.integer({ min: 0, max: MAX_STEP_MS }),
      }),
      { minLength: 1, maxLength: 40 },
    ),
  }),
);

const dayKey = (t: number): string => new Date(t).toISOString().slice(0, 10);

function initialState(s: GatewaySettings, reminders: ReminderState): GatewayState {
  return {
    stopList: new Set(),
    allowlist: new Set(),
    rate: new Map(),
    slowDown: new Map(),
    counters: { dayKey: '', received: 0, repliesSent: 0, replied: 0, partsSent: 0, ignored: 0, handed: 0 },
    settings: s,
    reminders,
  };
}

/** One message through evaluateInbound and completeReply, with no Answer_Service. */
function decide(msg: InboundMessage, state: GatewayState): GatewayDecision {
  const ctx = { paused: false, today: dayKey(msg.receivedAt) };
  const step = evaluateInbound(msg, state, ctx, routeCommand, false, splitSms);
  if (step.kind === 'final') return step.decision;
  if (step.kind === 'reply') return completeReply(step.pending, step.text, state, splitSms);
  throw new Error('Answer_Service requested with no Gemini_Api_Key');
}

function expectLimitAndSlots(state: GatewayState, pool: readonly CanonicalNumber[]): void {
  if (state.reminders.status !== 'ok') return;
  const { reminders } = state.reminders;
  expect(new Set(reminders.map((r) => r.id)).size).toBe(reminders.length);
  for (const number of new Set([...pool, ...reminders.map((r) => r.number)])) {
    const slots = reminders.filter((r) => r.number === number).map((r) => r.slot);
    expect(slots.length).toBeLessThanOrEqual(REMINDER_LIMIT);
    expect(new Set(slots).size).toBe(slots.length);
    for (const slot of slots) expect([1, 2, 3, 4, 5]).toContain(slot);
  }
}

describe('reminder.pipeline Reminder_Limit and slots', () => {
  // Feature: sms-reminders, Property 18: Reminder_Limit and distinct slots hold over any sequence
  it('5.13 every number keeps at most 5 reminders in distinct slots 1–5 after every step', () => {
    /** **Validates: Requirements 5.13** */
    fc.assert(
      fc.property(scenario, ({ pool, settings: s, reminders, start, steps }) => {
        let state = initialState(s, reminders);
        let t = start;
        expectLimitAndSlots(state, pool);
        steps.forEach((step, i) => {
          t += step.gap;
          const msg: InboundMessage = { id: `m${String(i)}`, seq: i, sender: step.from, body: step.body, receivedAt: t };
          state = applyChanges(state, decide(msg, state).changes);
          expectLimitAndSlots(state, pool);
        });
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
