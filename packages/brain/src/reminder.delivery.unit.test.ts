// Unit tests for the Delivery_Decision boundaries (sms-reminders task 11.10).
// Validates: Requirements 10.2, 10.3, 10.4, 10.7, 10.13, 14.4
import { describe, expect, it } from 'vitest';
import { zeroCounters } from './gateway.counters.js';
import { isCanonicalNumber } from './gateway.number.js';
import { applyChanges } from './gateway.pipeline.js';
import { DEFAULT_SETTINGS } from './gateway.settings.js';
import type { CanonicalNumber, GatewayState, SendReport } from './gateway.types.js';
import { decideDelivery, deliveryText, finalizeDelivery } from './reminder.delivery.js';
import { dueReminders } from './reminder.store.js';
import { LATE_WINDOW_MS, type Reminder, type ReminderId } from './reminder.types.js';
import { splitSms } from './sms.js';

const num = (s: string): CanonicalNumber => {
  if (!isCanonicalNumber(s)) throw new Error(`not canonical: ${s}`);
  return s;
};
const isReminderId = (id: string): id is ReminderId => id.startsWith('r:');
const rid = (s: string): ReminderId => {
  const id = `r:${s}`;
  if (!isReminderId(id)) throw new Error(`not a reminder id: ${id}`);
  return id;
};

const A = num('+923001234567');
const DUE = 1_736_953_200_000; // 2025-01-15T15:00:00Z = 20:00 Pakistan_Time
const TODAY = '2025-01-15';
const CAP = 10;

const SHORT: Reminder = {
  id: rid('m1'),
  number: A,
  slot: 1,
  dueAt: DUE,
  text: 'take medicine',
  language: 'en',
  createdAt: DUE - 36_000_000,
  handedAt: null,
};
/** 140 Urdu letters: a UCS-2 Reminder_Delivery_Text of 151 units, more than 1 part. */
const LONG: Reminder = { ...SHORT, id: rid('m2'), slot: 2, text: 'د'.repeat(140), language: 'ur' };

function stateWith(r: Reminder, over: Partial<GatewayState> = {}, handed = 0): GatewayState {
  return {
    stopList: new Set(),
    allowlist: new Set(),
    rate: new Map(),
    slowDown: new Map(),
    counters: { ...zeroCounters(TODAY), handed },
    settings: { ...DEFAULT_SETTINGS, dailySendCap: CAP },
    reminders: { status: 'ok', reminders: [r] },
    ...over,
  };
}

const partsOf = (r: Reminder): number => splitSms(deliveryText(r)).length;

describe('decideDelivery: Late_Window boundary (10.3, 14.4)', () => {
  it('decided exactly at dueAt + 3,600,000 gives the Reply_Parts', () => {
    const now = DUE + 3_600_000;
    expect(now).toBe(DUE + LATE_WINDOW_MS);
    const step = decideDelivery(SHORT, stateWith(SHORT), now, TODAY);
    expect(step.kind).toBe('send');
    if (step.kind !== 'send') return;
    expect(step.parts).toEqual(['Reminder: take medicine']);
    expect(step.changes).toEqual([
      { type: 'reminder-handed', id: SHORT.id, at: now },
      { type: 'counters', counters: { ...zeroCounters(TODAY), handed: 1 } },
    ]);
  });

  it('decided at dueAt + 3,600,001 gives reminder-expired with no parts', () => {
    const step = decideDelivery(SHORT, stateWith(SHORT), DUE + 3_600_001, TODAY);
    expect(step).toEqual({
      kind: 'final',
      outcome: 'reminder-expired',
      changes: [{ type: 'reminder-remove', id: SHORT.id }],
    });
  });
});

describe('decideDelivery: Daily_Send_Cap boundary (10.4, 14.4)', () => {
  it('a 1-part text bringing handed exactly to the cap is sent; 1 part over is capped', () => {
    expect(partsOf(SHORT)).toBe(1);
    const atCap = decideDelivery(SHORT, stateWith(SHORT, {}, CAP - 1), DUE, TODAY);
    expect(atCap.kind).toBe('send');
    const over = decideDelivery(SHORT, stateWith(SHORT, {}, CAP), DUE, TODAY);
    expect(over).toEqual({
      kind: 'final',
      outcome: 'reminder-capped',
      changes: [{ type: 'reminder-remove', id: SHORT.id }],
    });
  });

  it('a multipart text bringing handed exactly to the cap is sent; 1 part over is capped', () => {
    const n = partsOf(LONG);
    expect(n).toBeGreaterThan(1);
    const atCap = decideDelivery(LONG, stateWith(LONG, {}, CAP - n), DUE, TODAY);
    expect(atCap.kind).toBe('send');
    if (atCap.kind === 'send') {
      expect(atCap.parts).toHaveLength(n);
      const after = applyChanges(stateWith(LONG, {}, CAP - n), atCap.changes);
      expect(after.counters.handed).toBe(CAP);
    }
    const over = decideDelivery(LONG, stateWith(LONG, {}, CAP - n + 1), DUE, TODAY);
    expect(over.kind).toBe('final');
    if (over.kind === 'final') expect(over.outcome).toBe('reminder-capped');
  });

  it('counters of an earlier day do not count toward today', () => {
    const s = stateWith(SHORT, { counters: { ...zeroCounters('2025-01-14'), handed: CAP } });
    expect(decideDelivery(SHORT, s, DUE, TODAY).kind).toBe('send');
  });
});

describe('decideDelivery: not yet due (10.13)', () => {
  it('dueAt > now gives wait and leaves the store unchanged', () => {
    const s = stateWith(SHORT);
    expect(decideDelivery(SHORT, s, DUE - 1, TODAY)).toEqual({ kind: 'wait' });
    expect(dueReminders(s.reminders, DUE - 1)).toEqual([]);
  });

  it('dueAt === now is due', () => {
    expect(decideDelivery(SHORT, stateWith(SHORT), DUE, TODAY).kind).toBe('send');
  });
});

describe('decideDelivery: Allowlist_Mode (10.2)', () => {
  it('an unreadable Allowlist under Allowlist_Mode gives reminder-not-allowed', () => {
    const s = stateWith(SHORT, {
      allowlist: 'unreadable',
      settings: { ...DEFAULT_SETTINGS, dailySendCap: CAP, allowlistMode: true },
    });
    expect(decideDelivery(SHORT, s, DUE, TODAY)).toEqual({
      kind: 'final',
      outcome: 'reminder-not-allowed',
      changes: [{ type: 'reminder-remove', id: SHORT.id }],
    });
  });

  it('a listed number under Allowlist_Mode is sent', () => {
    const s = stateWith(SHORT, {
      allowlist: new Set([A]),
      settings: { ...DEFAULT_SETTINGS, dailySendCap: CAP, allowlistMode: true },
    });
    expect(decideDelivery(SHORT, s, DUE, TODAY).kind).toBe('send');
  });
});

describe('finalizeDelivery (10.7)', () => {
  /** Decides LONG with `start` parts already handed, then returns the state and part count. */
  function handedLong(start: number): { state: GatewayState; n: number } {
    const base = stateWith(LONG, {}, start);
    const step = decideDelivery(LONG, base, DUE, TODAY);
    if (step.kind !== 'send') throw new Error('expected send');
    return { state: applyChanges(base, step.changes), n: step.parts.length };
  }

  it('refused-stopped gives reminder-stopped, removes the reminder and releases every part', () => {
    const { state, n } = handedLong(2);
    expect(state.counters.handed).toBe(2 + n);
    const fin = finalizeDelivery(LONG, n, { status: 'refused-stopped' }, state.counters, TODAY);
    expect(fin.outcome).toBe('reminder-stopped');
    const after = applyChanges(state, fin.changes);
    expect(after.counters.handed).toBe(2);
    expect(after.counters.partsSent).toBe(0);
    expect(after.reminders).toEqual({ status: 'ok', reminders: [] });
  });

  it('a partial send gives reminder-failed and counts only the sent parts', () => {
    const { state, n } = handedLong(2);
    const report: SendReport = { status: 'done', results: ['sent', 'failed-radio'], attempts: 2 };
    const fin = finalizeDelivery(LONG, n, report, state.counters, TODAY);
    expect(fin.outcome).toBe('reminder-failed');
    const after = applyChanges(state, fin.changes);
    expect(after.counters.handed).toBe(2 + 1);
    expect(after.counters.partsSent).toBe(1);
    expect(after.reminders).toEqual({ status: 'ok', reminders: [] });
  });

  it('every part sent gives reminder-sent and counts every part', () => {
    const { state, n } = handedLong(0);
    const report: SendReport = {
      status: 'done',
      results: Array.from({ length: n }, () => 'sent' as const),
      attempts: 1,
    };
    const fin = finalizeDelivery(LONG, n, report, state.counters, TODAY);
    expect(fin.outcome).toBe('reminder-sent');
    const after = applyChanges(state, fin.changes);
    expect(after.counters.handed).toBe(n);
    expect(after.counters.partsSent).toBe(n);
  });
});
