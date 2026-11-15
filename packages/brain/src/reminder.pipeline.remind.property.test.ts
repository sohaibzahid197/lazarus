import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalNumber } from './gateway.arbitraries.js';
import { completeReply, evaluateInbound } from './gateway.pipeline.js';
import type { CanonicalNumber, GatewaySettings, GatewayState, InboundMessage } from './gateway.types.js';
import { formatWhen } from './reminder.clock.js';
import {
  REMINDER_PBT_OPTIONS,
  printableReminderText,
  receiveTime,
  reminderStore,
  timeExpression,
} from './reminder.arbitraries.js';
import { parseReminder } from './reminder.parse.js';
import { printTimeExpression } from './reminder.print.js';
import { resolveDueTime } from './reminder.resolve.js';
import { activeFor, lowestFreeSlot } from './reminder.store.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import { REMINDER_LIMIT, REMINDER_TEXT_MAX, type ReminderState, type TimeExpression } from './reminder.types.js';
import { routeCommand } from './router.js';
import { splitSms } from './sms.js';

/** Relative 1 to 120 minutes: always resolves, so few runs are discarded. */
const nearExpr: fc.Arbitrary<TimeExpression> = fc
  .integer({ min: 1, max: 120 })
  .map((amount) => ({ kind: 'relative', amount, unit: 'minute' }) as const);

const exprArb = fc.oneof({ arbitrary: nearExpr, weight: 1 }, { arbitrary: timeExpression, weight: 2 });

/** A Reminder_Text, sometimes with another phone number appended (Property 16). */
const textArb: fc.Arbitrary<string> = fc
  .tuple(printableReminderText, fc.option(canonicalNumber, { nil: null }))
  .map(([text, other]) => (other === null ? text : `${text} ${other}`))
  .filter((text) => text.length <= REMINDER_TEXT_MAX);

/** Every gateway check passes: allowlist off, high limits, no Own_Number. */
const permissive: GatewaySettings = {
  allowlistMode: false,
  perNumberLimit: 60,
  rateWindowMinutes: 60,
  dailySendCap: 2000,
  defaultCountryCode: '92',
  ownNumber: null,
};

function stateWith(reminders: ReminderState): GatewayState {
  return {
    stopList: new Set(),
    allowlist: new Set(),
    rate: new Map(),
    slowDown: new Map(),
    counters: { dayKey: '', received: 0, repliesSent: 0, replied: 0, partsSent: 0, ignored: 0, handed: 0 },
    settings: permissive,
    reminders,
  };
}

const scenario = canonicalNumber.chain((sender: CanonicalNumber) =>
  fc.record({
    sender: fc.constant(sender),
    reminders: reminderStore([sender]),
    expr: exprArb,
    text: textArb,
    receivedAt: receiveTime,
    messageId: fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/),
  }),
);

const dayKey = (t: number): string => new Date(t).toISOString().slice(0, 10);

describe('reminder.pipeline successful REMIND', () => {
  // Feature: sms-reminders, Property 16: A successful REMIND adds one correct reminder
  it('5.1 a REMIND that parses and resolves adds one reminder in the lowest free slot and replies with the set text', () => {
    /** **Validates: Requirements 5.1, 5.2, 5.12, 7.6** */
    fc.assert(
      fc.property(scenario, ({ sender, reminders, expr, text, receivedAt, messageId }) => {
        const active = activeFor(reminders, sender);
        fc.pre(active.length < REMINDER_LIMIT);
        const resolved = resolveDueTime(expr, receivedAt);
        fc.pre(resolved.ok);
        if (!resolved.ok) return;
        const slot = lowestFreeSlot(active);
        if (slot === null) throw new Error('no free slot with fewer than 5 reminders');

        const body = `REMIND ${printTimeExpression(expr)} ${text}`;
        const routed = routeCommand(body);
        const { language } = routed;
        // Property 16 covers bodies whose argument parses. Normalization collapses
        // whitespace runs and can expand compatibility characters past 140 units,
        // so the stored text is the parser output.
        const parsed = parseReminder(routed.argument);
        fc.pre(parsed.ok);
        if (!parsed.ok) return;
        const msg: InboundMessage = { id: messageId, seq: 1, sender, body, receivedAt };
        const state = stateWith(reminders);
        // aiAvailable is true: the REMIND must still not ask the Answer_Service.
        const step = evaluateInbound(msg, state, { paused: false, today: dayKey(receivedAt) }, routeCommand, true, splitSms);
        expect(step.kind).toBe('reply');
        if (step.kind !== 'reply') return;
        const decision = completeReply(step.pending, step.text, state, splitSms);

        const expectedText = REMINDER_TEXTS[language].set(slot, formatWhen(resolved.dueAt, language));
        expect(decision.outcome).toBe('replied');
        expect(decision.parts).toEqual(splitSms(expectedText));
        expect(decision.parts).toHaveLength(1);
        const adds = decision.changes.filter((c) => c.type === 'reminder-add');
        expect(adds).toEqual([
          {
            type: 'reminder-add',
            reminder: {
              id: `r:${messageId}`,
              number: sender,
              slot,
              dueAt: resolved.dueAt,
              text: parsed.text,
              language,
              createdAt: receivedAt,
              handedAt: null,
            },
          },
        ]);
        expect(decision.changes.some((c) => c.type === 'reminder-remove' || c.type === 'reminder-remove-all')).toBe(false);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
