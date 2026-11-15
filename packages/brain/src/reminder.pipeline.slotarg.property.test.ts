import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalNumber, timeArb } from './gateway.arbitraries.js';
import { applyChanges, completeReply, evaluateInbound } from './gateway.pipeline.js';
import type {
  CanonicalNumber,
  GatewayDecision,
  GatewaySettings,
  GatewayState,
  InboundMessage,
  StateChange,
} from './gateway.types.js';
import { REMINDER_PBT_OPTIONS, reminderStore, slotSpelling } from './reminder.arbitraries.js';
import { parseSlotArgument } from './reminder.pipeline.js';
import { activeFor, findBySlot } from './reminder.store.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import type { ReminderState } from './reminder.types.js';
import { routeCommand } from './router.js';
import { splitSms } from './sms.js';

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

/** CANCEL keywords in English, Roman Urdu and Urdu script. */
const keyword = fc.constantFrom('CANCEL', 'cancel', 'Cancel', 'mansookh', 'MANSOOKH', 'منسوخ');

/** Value 0 to 999, weighted toward 0 to 6 so real slots are hit often. */
const slotValue: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 6 }), weight: 4 },
  { arbitrary: fc.integer({ min: 0, max: 999 }), weight: 1 },
);

const spelled = slotValue.chain((n) => fc.record({ n: fc.constant(n), spelling: slotSpelling(n) }));

const scenario = fc.uniqueArray(canonicalNumber, { minLength: 2, maxLength: 2 }).chain(([sender, other]) =>
  fc.record({
    sender: fc.constant(sender as CanonicalNumber),
    reminders: reminderStore([sender as CanonicalNumber, other as CanonicalNumber]),
    keyword,
    slot: spelled,
    receivedAt: timeArb,
  }),
);

const reminderChanges = (d: GatewayDecision): readonly StateChange[] =>
  d.changes.filter((c) => c.type.startsWith('reminder-'));

const dayKey = (t: number): string => new Date(t).toISOString().slice(0, 10);

function decide(msg: InboundMessage, state: GatewayState): GatewayDecision {
  const step = evaluateInbound(msg, state, { paused: false, today: dayKey(msg.receivedAt) }, routeCommand, false, splitSms);
  if (step.kind === 'final') return step.decision;
  if (step.kind === 'reply') return completeReply(step.pending, step.text, state, splitSms);
  throw new Error('Answer_Service requested with no Gemini_Api_Key');
}

describe('reminder.pipeline slot arguments', () => {
  // Feature: sms-reminders, Property 23: Slot arguments read as base-10 numbers
  it('7.2 parseSlotArgument reads every 1 to 3 digit spelling of n as n', () => {
    /** **Validates: Requirements 7.2** */
    fc.assert(
      fc.property(spelled, ({ n, spelling }) => {
        expect(parseSlotArgument(spelling)).toBe(n);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });

  // Feature: sms-reminders, Property 23: Slot arguments read as base-10 numbers
  it('7.2 CANCEL with any spelling of n selects the same slot as CANCEL with plain n', () => {
    /** **Validates: Requirements 7.2** */
    fc.assert(
      fc.property(scenario, ({ sender, reminders, keyword: kw, slot, receivedAt }) => {
        const spelledBody = `${kw} ${slot.spelling}`;
        const plainBody = `${kw} ${String(slot.n)}`;
        const routed = routeCommand(spelledBody);
        expect(routed.command).toBe('CANCEL');
        expect(routed.argumentMissing).toBe(false);
        const state = stateWith(reminders);
        const spelledDecision = decide({ id: 'm1', seq: 1, sender, body: spelledBody, receivedAt }, state);
        const plainDecision = decide({ id: 'm1', seq: 1, sender, body: plainBody, receivedAt }, state);

        // Same slot selected: same outcome, same reminder changes, same resulting store.
        const target = findBySlot(activeFor(reminders, sender), slot.n);
        const expectedChanges = target === null ? [] : [{ type: 'reminder-remove', id: target.id }];
        expect(spelledDecision.command).toBe('CANCEL');
        expect(spelledDecision.outcome).toBe(plainDecision.outcome);
        expect(reminderChanges(spelledDecision)).toEqual(expectedChanges);
        expect(reminderChanges(plainDecision)).toEqual(expectedChanges);
        expect(applyChanges(state, spelledDecision.changes).reminders).toEqual(
          applyChanges(state, plainDecision.changes).reminders,
        );

        // Reply is the expected text in the Language of the Routed_Command (7.1, 7.3).
        const texts = REMINDER_TEXTS[routed.language];
        const expectedText = target === null ? texts.noSuch : texts.cancelled(target.slot);
        expect(spelledDecision.language).toBe(routed.language);
        expect(spelledDecision.parts).toEqual(splitSms(expectedText));
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
