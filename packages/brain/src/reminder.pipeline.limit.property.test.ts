import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalNumber, timeArb } from './gateway.arbitraries.js';
import { completeReply, evaluateInbound } from './gateway.pipeline.js';
import { GATEWAY_TEXTS } from './gateway.texts.js';
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
  reminder,
  reminderStore,
  reminderText,
  timeExpression,
} from './reminder.arbitraries.js';
import { printTimeExpression } from './reminder.print.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import type { Reminder, ReminderId, ReminderSlot, ReminderState } from './reminder.types.js';
import { routeCommand } from './router.js';
import { splitSms } from './sms.js';

const SLOTS: readonly ReminderSlot[] = [1, 2, 3, 4, 5];

/** Settings under which every gateway check passes for a non-stopped sender. */
const PERMISSIVE: GatewaySettings = {
  allowlistMode: false,
  perNumberLimit: 60,
  rateWindowMinutes: 60,
  dailySendCap: 2000,
  defaultCountryCode: '92',
  ownNumber: null,
};

const keyword = fc.constantFrom('REMIND', 'remind', 'Remind', 'YAAD', 'yaad', 'یاد');

const nearTime: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 120 })
  .map((n) => printTimeExpression({ kind: 'relative', amount: n, unit: 'minute' }));

/** Non-empty REMIND arguments of every kind: valid, bad time, too long, past, too far, no text. */
const argument: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(nearTime, printableReminderText).map(([w, t]) => `${w} ${t}`),
  fc.tuple(timeExpression.map(printTimeExpression), reminderText).map(([w, t]) => `${w} ${t}`),
  printableReminderText.map((t) => `9 ${t}`),
  fc.tuple(nearTime, fc.integer({ min: 141, max: 300 })).map(([w, n]) => `${w} ${'x'.repeat(n)}`),
  fc.constantFrom('today 8am x', 'in 31 days x', 'in 43201 minutes x'),
  nearTime,
  fc.string({ minLength: 1, maxLength: 40 }),
);

/** Exactly 5 reminders for `number` in slots 1–5, plus other numbers' reminders. */
const storeFor = (number: CanonicalNumber): fc.Arbitrary<ReminderState> =>
  fc
    .tuple(fc.tuple(...SLOTS.map(() => reminder)), reminderStore())
    .map(([own, rest]): ReminderState => {
      const mine: Reminder[] = own.map((r, i) => ({
        ...r,
        // '.' never appears in generated ids, so these stay unique.
        id: `r:own.${String(i + 1)}` as ReminderId,
        number,
        slot: SLOTS[i] ?? 1,
      }));
      const others = rest.status === 'ok' ? rest.reminders.filter((r) => r.number !== number) : [];
      return { status: 'ok', reminders: [...mine, ...others] };
    });

const scenario = canonicalNumber.chain((number) =>
  fc.record({
    number: fc.constant(number),
    reminders: storeFor(number),
    receivedAt: timeArb,
  }),
);

function initialState(reminders: ReminderState): GatewayState {
  return {
    stopList: new Set(),
    allowlist: new Set(),
    rate: new Map(),
    slowDown: new Map(),
    counters: { dayKey: '', received: 0, repliesSent: 0, replied: 0, partsSent: 0, ignored: 0, handed: 0 },
    settings: PERMISSIVE,
    reminders,
  };
}

/** One message through evaluateInbound and completeReply, with no Answer_Service. */
function decide(msg: InboundMessage, state: GatewayState): GatewayDecision {
  const ctx = { paused: false, today: new Date(msg.receivedAt).toISOString().slice(0, 10) };
  const step = evaluateInbound(msg, state, ctx, routeCommand, false, splitSms);
  if (step.kind === 'final') return step.decision;
  if (step.kind === 'reply') return completeReply(step.pending, step.text, state, splitSms);
  throw new Error('Answer_Service requested with no Gemini_Api_Key');
}

const isReminderWrite = (type: string): boolean => type === 'reminder-add' || type === 'reminder-remove';

describe('reminder.pipeline Reminder_Limit check order', () => {
  // Feature: sms-reminders, Property 17: The Reminder_Limit is checked first
  it('5.8 5.14 REMIND with an argument at 5 reminders gets the Reminder_Limit_Text; bare REMIND gets the usage hint', () => {
    /** **Validates: Requirements 5.8, 5.14** */
    fc.assert(
      fc.property(
        scenario,
        keyword,
        fc.option(argument, { nil: null, freq: 5 }),
        ({ number, reminders, receivedAt }, kw, arg) => {
          const body = arg === null ? kw : `${kw} ${arg}`;
          const routed = routeCommand(body);
          fc.pre(routed.command === 'REMIND');
          const msg: InboundMessage = { id: 'm1', seq: 1, sender: number, body, receivedAt };
          const decision = decide(msg, initialState(reminders));
          const expected = routed.argumentMissing
            ? GATEWAY_TEXTS[routed.language].usage.REMIND
            : REMINDER_TEXTS[routed.language].limit;
          expect(decision.command).toBe('REMIND');
          expect(decision.language).toBe(routed.language);
          expect(decision.outcome).toBe('replied');
          expect(decision.parts).toEqual(splitSms(expected));
          expect(decision.changes.filter((c) => isReminderWrite(c.type))).toEqual([]);
        },
      ),
      REMINDER_PBT_OPTIONS,
    );
  });
});
