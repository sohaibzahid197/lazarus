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
} from './gateway.types.js';
import { REMINDER_PBT_OPTIONS, reminderStore } from './reminder.arbitraries.js';
import { activeFor, findBySlot } from './reminder.store.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import type { Reminder, ReminderState } from './reminder.types.js';
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

/** Slot argument 0 to 999, weighted toward 0 to 6 so real slots are hit often. */
const slotArg: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.integer({ min: 0, max: 6 }), weight: 4 },
  { arbitrary: fc.integer({ min: 0, max: 999 }), weight: 1 },
);

/** Sender plus one other number, so another number often holds the same slot. */
const scenario = fc.uniqueArray(canonicalNumber, { minLength: 2, maxLength: 2 }).chain(([sender, other]) =>
  fc.record({
    sender: fc.constant(sender as CanonicalNumber),
    other: fc.constant(other as CanonicalNumber),
    reminders: reminderStore([sender as CanonicalNumber, other as CanonicalNumber]),
    keyword,
    n: slotArg,
    receivedAt: timeArb,
  }),
);

const dayKey = (t: number): string => new Date(t).toISOString().slice(0, 10);

function decide(msg: InboundMessage, state: GatewayState): GatewayDecision {
  const step = evaluateInbound(msg, state, { paused: false, today: dayKey(msg.receivedAt) }, routeCommand, false, splitSms);
  if (step.kind === 'final') return step.decision;
  if (step.kind === 'reply') return completeReply(step.pending, step.text, state, splitSms);
  throw new Error('Answer_Service requested with no Gemini_Api_Key');
}

const sortById = (rs: readonly Reminder[]): Reminder[] =>
  [...rs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const remindersOf = (s: ReminderState): readonly Reminder[] => (s.status === 'ok' ? s.reminders : []);

describe('reminder.pipeline CANCEL', () => {
  // Feature: sms-reminders, Property 22: CANCEL removes at most one reminder, the sender's slot n
  it("7.8 CANCEL n removes at most one reminder, the sender's slot n, and leaves every other reminder unchanged", () => {
    /** **Validates: Requirements 7.1, 7.3, 7.5, 7.8** */
    fc.assert(
      fc.property(scenario, ({ sender, reminders, keyword: kw, n, receivedAt }) => {
        const body = `${kw} ${String(n)}`;
        const routed = routeCommand(body);
        expect(routed.command).toBe('CANCEL');
        expect(routed.argumentMissing).toBe(false);
        const texts = REMINDER_TEXTS[routed.language];
        const state = stateWith(reminders);
        const msg: InboundMessage = { id: 'm1', seq: 1, sender, body, receivedAt };
        const decision = decide(msg, state);

        expect(decision.outcome).toBe('replied');
        const reminderChanges = decision.changes.filter(
          (c) => c.type === 'reminder-add' || c.type === 'reminder-remove' || c.type === 'reminder-remove-all' || c.type === 'reminder-handed',
        );
        expect(reminderChanges.length).toBeLessThanOrEqual(1);

        const target = findBySlot(activeFor(reminders, sender), n);
        const before = remindersOf(reminders);
        const after = remindersOf(applyChanges(state, decision.changes).reminders);
        if (target !== null) {
          expect(reminderChanges).toEqual([{ type: 'reminder-remove', id: target.id }]);
          expect(decision.parts).toEqual(splitSms(texts.cancelled(target.slot)));
          expect(sortById(after)).toEqual(sortById(before.filter((r) => r.id !== target.id)));
        } else {
          expect(reminderChanges).toEqual([]);
          expect(decision.parts).toEqual(splitSms(texts.noSuch));
          expect(sortById(after)).toEqual(sortById(before));
        }
      }),
      REMINDER_PBT_OPTIONS,
    );
  });

  // Feature: sms-reminders, Property 22: CANCEL removes at most one reminder, the sender's slot n
  it('7.4 bare CANCEL replies with the Cancel_Usage_Text and changes no reminder', () => {
    /** **Validates: Requirements 7.1, 7.3, 7.5, 7.8** */
    fc.assert(
      fc.property(scenario, ({ sender, reminders, keyword: kw, receivedAt }) => {
        const routed = routeCommand(kw);
        expect(routed.command).toBe('CANCEL');
        expect(routed.argumentMissing).toBe(true);
        const state = stateWith(reminders);
        const decision = decide({ id: 'm1', seq: 1, sender, body: kw, receivedAt }, state);
        expect(decision.outcome).toBe('replied');
        expect(decision.parts).toEqual(splitSms(REMINDER_TEXTS[routed.language].cancelUsage));
        expect(decision.changes.some((c) => c.type.startsWith('reminder-'))).toBe(false);
        expect(applyChanges(state, decision.changes).reminders).toEqual(reminders);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
