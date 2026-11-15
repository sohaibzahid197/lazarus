import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalNumber } from './gateway.arbitraries.js';
import { applyChanges, completeReply, evaluateInbound } from './gateway.pipeline.js';
import type {
  CanonicalNumber,
  GatewayDecision,
  GatewaySettings,
  GatewayState,
  InboundMessage,
} from './gateway.types.js';
import { formatWhen } from './reminder.clock.js';
import { formatReminderList } from './reminder.list.js';
import { REMINDER_PBT_OPTIONS, receiveTime, reminderStore } from './reminder.arbitraries.js';
import { activeFor } from './reminder.store.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import type { Reminder, ReminderId, ReminderState } from './reminder.types.js';
import { caseMutate, listAliasArb } from './router.arbitraries.js';
import { routeCommand } from './router.js';
import type { Language } from './router.types.js';
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

/** `#` never occurs in a generated Reminder_Text, the List lead or a Due_Time. */
const MARKER_CHAR = '#';
const marker = (i: number): string => `${MARKER_CHAR}Q${String(i)}${MARKER_CHAR}`;

const isReminderId = (id: string): id is ReminderId => id.startsWith('r:');
function withId(r: Reminder, id: string): Reminder {
  return isReminderId(id) ? { ...r, id } : r;
}

const listBody: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom('', ' ', '  '), listAliasArb.chain(caseMutate), fc.constantFrom('', ' ', '\n'))
  .map(([lead, alias, tail]) => lead + alias + tail);

/**
 * The sender's reminders (0 to 5) plus reminders of 1 to 3 other numbers,
 * each other reminder carrying a distinctive marker text, in random order.
 */
const scenario = fc
  .uniqueArray(canonicalNumber, { minLength: 2, maxLength: 4 })
  .chain(([sender, ...others]) => {
    if (sender === undefined) throw new Error('uniqueArray gave no sender');
    const own = reminderStore([sender]).map((s) =>
      s.status === 'ok' ? s.reminders.filter((r) => r.number === sender) : [],
    );
    const foreign = reminderStore(others).map((s) =>
      s.status === 'ok' ? s.reminders.filter((r) => r.number !== sender) : [],
    );
    return fc.record({
      sender: fc.constant(sender),
      others: fc.constant(others),
      reminders: fc
        .tuple(own, foreign)
        .map(([mine, theirs]) => [
          ...mine.map((r, i) => withId(r, `${r.id}-s${String(i)}`)),
          ...theirs.map((r, i) => ({ ...withId(r, `${r.id}-o${String(i)}`), text: marker(i) })),
        ])
        .chain((all) => fc.shuffledSubarray(all, { minLength: all.length })),
      body: listBody,
      receivedAt: receiveTime,
    });
  });

const dayKey = (t: number): string => new Date(t).toISOString().slice(0, 10);

function decide(msg: InboundMessage, state: GatewayState): GatewayDecision {
  const ctx = { paused: false, today: dayKey(msg.receivedAt) };
  const step = evaluateInbound(msg, state, ctx, routeCommand, true, splitSms);
  if (step.kind === 'final') return step.decision;
  if (step.kind === 'reply') return completeReply(step.pending, step.text, state, splitSms);
  throw new Error('LIST asked the Answer_Service');
}

const head = (r: Reminder, language: Language): string => `${String(r.slot)}) ${formatWhen(r.dueAt, language)}`;

/** Digits of a Canonical_Number without the leading `+`. */
const digitsOf = (n: CanonicalNumber): string => n.replace(/^\+/, '');

describe('reminder.pipeline LIST privacy', () => {
  // Feature: sms-reminders, Property 21: LIST shows only the sender's reminders and changes nothing
  it("6.6 LIST replies with only the sender's reminders and leaves the Reminder_Store unchanged", () => {
    /** **Validates: Requirements 6.6, 6.7** */
    fc.assert(
      fc.property(scenario, ({ sender, others, reminders, body, receivedAt }) => {
        const store: ReminderState = { status: 'ok', reminders };
        const routed = routeCommand(body);
        expect(routed.command).toBe('LIST');
        const { language } = routed;

        const state = stateWith(store);
        const msg: InboundMessage = { id: 'm1', seq: 1, sender, body, receivedAt };
        const decision = decide(msg, state);

        const mine = activeFor(store, sender);
        const expected =
          mine.length === 0 ? REMINDER_TEXTS[language].noReminders : formatReminderList(mine, language, splitSms);
        expect(decision.outcome).toBe('replied');
        expect(decision.parts).toEqual(splitSms(expected));

        // Leak checks run on the unsplit Reply_Text, so no entry hides across a part boundary.
        const reply = expected;
        expect(decision.parts.join('')).not.toContain(MARKER_CHAR);
        expect(reply).not.toContain(MARKER_CHAR);
        const ownHeads = mine.map((r) => head(r, language));
        for (const r of reminders.filter((x) => x.number !== sender)) {
          const theirs = head(r, language);
          if (!ownHeads.some((h) => h.includes(theirs))) expect(reply).not.toContain(theirs);
        }
        for (const n of others) expect(reply).not.toContain(digitsOf(n));

        for (const c of decision.changes) {
          expect(['rate-record', 'counters']).toContain(c.type);
          if (c.type === 'rate-record') expect(c.number).toBe(sender);
        }
        expect(applyChanges(state, decision.changes).reminders).toEqual(store);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
