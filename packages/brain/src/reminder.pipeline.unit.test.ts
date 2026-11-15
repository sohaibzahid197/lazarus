// Boundary examples for REMIND, LIST and CANCEL in the Gateway_Pipeline
// (sms-reminders task 10.12; Requirements 5.8, 5.11, 7.1, 7.3, 7.7, 8.5, 9.10,
// 12.7, 12.11, 14.4). Explicit millisecond times, no real clock.
import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  completeReply,
  evaluateInbound,
  runGatewayPipeline,
} from './gateway.pipeline.js';
import { GATEWAY_TEXTS } from './gateway.texts.js';
import type {
  CanonicalNumber,
  GatewayDecision,
  GatewayState,
  InboundMessage,
  StateChange,
} from './gateway.types.js';
import { formatWhen } from './reminder.clock.js';
import { reminderWriteFailed } from './reminder.pipeline.js';
import { activeFor } from './reminder.store.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import { EMPTY_REMINDERS } from './reminder.types.js';
import type { Reminder, ReminderId, ReminderSlot, ReminderState } from './reminder.types.js';
import { routeCommand } from './router.js';
import { splitSms } from './sms.js';

/** 2025-01-15T05:00:00Z, 10:00 Pakistan_Time. */
const T = 1_736_917_200_000;
const TODAY = '2025-01-15';
const SENDER = '+923001234567' as CanonicalNumber;
const OTHER = '+923009876543' as CanonicalNumber;
const CAP = 100;

const EN = REMINDER_TEXTS.en;
/** `REMIND 8pm ...` at T is due 2025-01-15T15:00:00Z, 20:00 Pakistan_Time. */
const DUE_8PM = T + 36_000_000;
const SET_1 = EN.set(1, formatWhen(DUE_8PM, 'en'));

function reminder(number: CanonicalNumber, slot: ReminderSlot): Reminder {
  return {
    id: `r:${number}-${String(slot)}` as ReminderId,
    number,
    slot,
    dueAt: T + 3_600_000 * slot,
    text: `task ${String(slot)}`,
    language: 'en',
    createdAt: T - 60_000,
    handedAt: null,
  };
}

const store = (...rs: Reminder[]): ReminderState => ({ status: 'ok', reminders: rs });
const UNREADABLE: ReminderState = { status: 'unreadable' };

function stateWith(reminders: ReminderState, handed = 0): GatewayState {
  return {
    stopList: new Set(),
    allowlist: new Set(),
    rate: new Map(),
    slowDown: new Map(),
    counters: { dayKey: TODAY, received: 0, repliesSent: 0, replied: 0, partsSent: 0, ignored: 0, handed },
    settings: {
      allowlistMode: false,
      perNumberLimit: 60,
      rateWindowMinutes: 60,
      dailySendCap: CAP,
      defaultCountryCode: '92',
      ownNumber: null,
    },
    reminders,
  };
}

let seq = 0;
function msg(body: string, receivedAt = T, sender: string = SENDER): InboundMessage {
  seq += 1;
  return { id: `m${String(seq)}`, seq, sender, body, receivedAt };
}

/** Synchronous evaluate → complete, with no Gemini_Api_Key. */
function decide(m: InboundMessage, state: GatewayState): GatewayDecision {
  const step = evaluateInbound(m, state, { paused: false, today: TODAY }, routeCommand, false, splitSms);
  if (step.kind === 'final') return step.decision;
  if (step.kind === 'reply') return completeReply(step.pending, step.text, state, splitSms);
  throw new Error('Answer_Service requested with no Gemini_Api_Key');
}

const run = (m: InboundMessage, state: GatewayState): Promise<GatewayDecision> =>
  runGatewayPipeline(m, state, { paused: false, today: TODAY }, { answer: null });

const isReminderChange = (c: StateChange): boolean =>
  c.type === 'reminder-add' ||
  c.type === 'reminder-remove' ||
  c.type === 'reminder-remove-all' ||
  c.type === 'reminder-handed';

const reminderChanges = (d: GatewayDecision): StateChange[] => d.changes.filter(isReminderChange);

const remindersAfter = (state: GatewayState, d: GatewayDecision): ReminderState =>
  applyChanges(state, d.changes).reminders;

const FIVE = store(...([1, 2, 3, 4, 5] as const).map((s) => reminder(SENDER, s)));

describe('reminder.pipeline boundaries', () => {
  it('5.8 a sixth REMIND gets the Reminder_Limit_Text and adds no Reminder', () => {
    const state = stateWith(FIVE);
    const d = decide(msg('REMIND 8pm take medicine'), state);
    expect(d.outcome).toBe('replied');
    expect(d.parts).toEqual(splitSms(EN.limit));
    expect(reminderChanges(d)).toEqual([]);
    expect(remindersAfter(state, d)).toEqual(FIVE);
  });

  it('5.8 the limit wins even when the time cannot be parsed', () => {
    const d = decide(msg('REMIND sometime take medicine'), stateWith(FIVE));
    expect(d.parts).toEqual(splitSms(EN.limit));
    expect(reminderChanges(d)).toEqual([]);
  });

  it.each([1, 5] as const)('7.1 CANCEL %i removes that slot and replies with the Reminder_Cancelled_Text', (n) => {
    const state = stateWith(store(reminder(SENDER, 1), reminder(SENDER, 5), reminder(OTHER, n)));
    const d = decide(msg(`CANCEL ${String(n)}`), state);
    const target = reminder(SENDER, n);
    expect(d.outcome).toBe('replied');
    expect(d.parts).toEqual(splitSms(EN.cancelled(n)));
    expect(reminderChanges(d)).toEqual([{ type: 'reminder-remove', id: target.id }]);
    const after = remindersAfter(state, d);
    expect(activeFor(after, SENDER).map((r) => r.slot)).toEqual(n === 1 ? [5] : [1]);
    expect(activeFor(after, OTHER)).toEqual([reminder(OTHER, n)]);
  });

  it.each([0, 6])('7.3 CANCEL %i gets the No_Such_Reminder_Text with every Reminder unchanged', (n) => {
    const state = stateWith(FIVE);
    const d = decide(msg(`CANCEL ${String(n)}`), state);
    expect(d.outcome).toBe('replied');
    expect(d.parts).toEqual(splitSms(EN.noSuch));
    expect(reminderChanges(d)).toEqual([]);
    expect(remindersAfter(state, d)).toEqual(FIVE);
  });

  describe('Daily_Send_Cap', () => {
    it('5.11 cap reached before the reply: send-capped, no reminder-add', () => {
      const existing = store(reminder(SENDER, 2));
      const state = stateWith(existing, CAP);
      const d = decide(msg('REMIND 8pm take medicine'), state);
      expect(d.outcome).toBe('send-capped');
      expect(d.parts).toEqual([]);
      expect(reminderChanges(d)).toEqual([]);
      expect(remindersAfter(state, d)).toEqual(existing);
    });

    it('5.11 completeReply blocking a Reminder_Set_Text drops the reminder-add', () => {
      const existing = store(reminder(SENDER, 2));
      const open = stateWith(existing, CAP - 1);
      const step = evaluateInbound(msg('REMIND 8pm take medicine'), open, { paused: false, today: TODAY }, routeCommand, false, splitSms);
      if (step.kind !== 'reply') throw new Error(`expected a reply step, got ${step.kind}`);
      expect(step.pending.changes.some((c) => c.type === 'reminder-add')).toBe(true);
      expect(step.text).toBe(SET_1);
      const capped = stateWith(existing, CAP);
      const d = completeReply(step.pending, step.text, capped, splitSms);
      expect(d.outcome).toBe('send-capped');
      expect(d.parts).toEqual([]);
      expect(reminderChanges(d)).toEqual([]);
      expect(d.changes.some((c) => c.type === 'counters')).toBe(false);
      expect(remindersAfter(capped, d)).toEqual(existing);
    });

    it('7.7 cap reached before the reply: CANCEL still removes, send-capped', () => {
      const state = stateWith(store(reminder(SENDER, 3)), CAP);
      const d = decide(msg('CANCEL 3'), state);
      expect(d.outcome).toBe('send-capped');
      expect(d.parts).toEqual([]);
      expect(reminderChanges(d)).toEqual([{ type: 'reminder-remove', id: reminder(SENDER, 3).id }]);
      expect(remindersAfter(state, d)).toEqual(store());
    });

    it('7.7 completeReply blocking a Reminder_Cancelled_Text keeps the reminder-remove', () => {
      const existing = store(reminder(SENDER, 3));
      const open = stateWith(existing, CAP - 1);
      const step = evaluateInbound(msg('CANCEL 3'), open, { paused: false, today: TODAY }, routeCommand, false, splitSms);
      if (step.kind !== 'reply') throw new Error(`expected a reply step, got ${step.kind}`);
      expect(step.text).toBe(EN.cancelled(3));
      const capped = stateWith(existing, CAP);
      const d = completeReply(step.pending, step.text, capped, splitSms);
      expect(d.outcome).toBe('send-capped');
      expect(d.parts).toEqual([]);
      expect(reminderChanges(d)).toEqual([{ type: 'reminder-remove', id: reminder(SENDER, 3).id }]);
      expect(remindersAfter(capped, d)).toEqual(store());
    });

    it('7.7 CANCEL of an empty slot at the cap removes nothing', () => {
      const existing = store(reminder(SENDER, 3));
      const state = stateWith(existing, CAP);
      const d = decide(msg('CANCEL 4'), state);
      expect(d.outcome).toBe('send-capped');
      expect(reminderChanges(d)).toEqual([]);
      expect(remindersAfter(state, d)).toEqual(existing);
    });
  });

  describe('12.7 unreadable Reminder_Store', () => {
    it.each([
      ['REMIND 8pm take medicine', 'en'],
      ['REMIND', 'en'],
      ['LIST', 'en'],
      ['CANCEL 1', 'en'],
      ['CANCEL', 'en'],
      ['YAAD 8pm dawai leni hai', 'roman-ur'],
      ['fehrist', 'roman-ur'],
      ['منسوخ 1', 'ur'],
      ['یاد', 'ur'],
    ] as const)('%s gets the Reminders_Unavailable_Text in its Language', (body, language) => {
      const state = stateWith(UNREADABLE);
      const d = decide(msg(body), state);
      expect(d.language).toBe(language);
      expect(d.outcome).toBe('replied');
      expect(d.parts).toEqual(splitSms(REMINDER_TEXTS[language].unavailable));
      expect(reminderChanges(d)).toEqual([]);
      expect(remindersAfter(state, d)).toEqual(UNREADABLE);
    });

    it('CANCEL at the cap removes nothing from an unreadable store', () => {
      const d = decide(msg('CANCEL 1'), stateWith(UNREADABLE, CAP));
      expect(d.outcome).toBe('send-capped');
      expect(reminderChanges(d)).toEqual([]);
    });

    it('STOP still emits reminder-remove-all and the store stays unreadable', () => {
      const state = stateWith(UNREADABLE);
      const d = decide(msg('STOP'), state);
      expect(d.outcome).toBe('stopped');
      expect(d.changes).toEqual([
        { type: 'stop-add', number: SENDER },
        { type: 'reminder-remove-all', number: SENDER },
      ]);
      const after = applyChanges(state, d.changes);
      expect(after.stopList.has(SENDER)).toBe(true);
      expect(after.reminders).toEqual(UNREADABLE);
    });
  });

  it('5.4 bare REMIND with a readable store gets the REMIND usage hint', () => {
    const d = decide(msg('REMIND'), stateWith(EMPTY_REMINDERS));
    expect(d.parts).toEqual(splitSms(GATEWAY_TEXTS.en.usage.REMIND));
    expect(reminderChanges(d)).toEqual([]);
  });

  describe('12.11 reminderWriteFailed', () => {
    it('replaces a Reminder_Set_Text with the Reminders_Unavailable_Text and drops the reminder-add', () => {
      const state = stateWith(EMPTY_REMINDERS, 7);
      const d = decide(msg('REMIND 8pm take medicine'), state);
      expect(d.parts).toEqual(splitSms(SET_1));
      expect(reminderChanges(d)).toHaveLength(1);
      const failed = reminderWriteFailed(d, splitSms);
      const parts = splitSms(EN.unavailable);
      expect(failed.parts).toEqual(parts);
      expect(failed.outcome).toBe('replied');
      expect(reminderChanges(failed)).toEqual([]);
      expect(failed.changes.filter((c) => c.type === 'rate-record')).toHaveLength(1);
      const counters = failed.changes.find((c) => c.type === 'counters');
      expect(counters?.type === 'counters' ? counters.counters.handed : null).toBe(7 + parts.length);
      expect(remindersAfter(state, failed)).toEqual(EMPTY_REMINDERS);
    });

    it('replaces a Reminder_Cancelled_Text in the Language of the command and drops the reminder-remove', () => {
      const existing = store(reminder(SENDER, 2));
      const state = stateWith(existing);
      const d = decide(msg('منسوخ 2'), state);
      expect(d.parts).toEqual(splitSms(REMINDER_TEXTS.ur.cancelled(2)));
      const failed = reminderWriteFailed(d, splitSms);
      expect(failed.parts).toEqual(splitSms(REMINDER_TEXTS.ur.unavailable));
      expect(reminderChanges(failed)).toEqual([]);
      expect(remindersAfter(state, failed)).toEqual(existing);
    });

    it('a capped CANCEL keeps no parts and drops the reminder-remove', () => {
      const d = decide(msg('CANCEL 2'), stateWith(store(reminder(SENDER, 2)), CAP));
      const failed = reminderWriteFailed(d, splitSms);
      expect(failed.outcome).toBe('send-capped');
      expect(failed.parts).toEqual([]);
      expect(reminderChanges(failed)).toEqual([]);
      expect(failed.changes).toEqual(d.changes.filter((c) => c.type !== 'reminder-remove'));
    });

    it('keeps a STOP reminder-remove-all', () => {
      const d = decide(msg('STOP'), stateWith(store(reminder(SENDER, 1))));
      expect(reminderWriteFailed(d, splitSms)).toEqual(d);
    });
  });

  it('8.5 STOP, START, LIST gives the No_Reminders_Text and the next REMIND gets slot 1', async () => {
    let state = stateWith(store(reminder(SENDER, 1), reminder(SENDER, 2), reminder(SENDER, 4), reminder(OTHER, 1)));
    const step = async (body: string, at: number): Promise<GatewayDecision> => {
      const d = await run(msg(body, at), state);
      state = applyChanges(state, d.changes);
      return d;
    };
    expect((await step('STOP', T)).outcome).toBe('stopped');
    expect(activeFor(state.reminders, SENDER)).toEqual([]);
    expect(activeFor(state.reminders, OTHER)).toEqual([reminder(OTHER, 1)]);
    const start = await step('START', T + 1_000);
    expect(start.outcome).toBe('started');
    expect(start.parts).toEqual(splitSms(GATEWAY_TEXTS.en.welcomeBack));
    const list = await step('LIST', T + 2_000);
    expect(list.parts).toEqual(splitSms(EN.noReminders));
    const remind = await step('REMIND 8pm take medicine', T + 3_000);
    const added = reminderChanges(remind);
    expect(added).toHaveLength(1);
    const first = added[0];
    expect(first?.type === 'reminder-add' ? [first.reminder.slot, first.reminder.dueAt] : null).toEqual([1, DUE_8PM]);
    expect(remind.parts).toEqual(splitSms(SET_1));
    expect(activeFor(state.reminders, SENDER).map((r) => r.slot)).toEqual([1]);
  });

  it('9.10 TRANSLATE with an argument still gets the Not_Available_Text', async () => {
    const d = await run(msg('TRANSLATE good morning'), stateWith(FIVE));
    expect(d.outcome).toBe('replied');
    expect(d.parts).toEqual(splitSms(GATEWAY_TEXTS.en.notAvailable));
    expect(reminderChanges(d)).toEqual([]);
  });
});

