// Reminder status in the UI store and loop helpers (sms-reminders task 18.3;
// Requirements 10.14, 11.9, 13.6, 13.7). Counts and banners only, never numbers or texts.
import { EMPTY_REMINDERS } from '@lazarus/brain';
import type { CanonicalNumber, Reminder, ReminderId, ReminderState } from '@lazarus/brain';
import { reminderCountOf, showExactAlarmStatus, showReminderStatus } from '../src/gateway/loopSupport';
import { BANNERS, createGatewayStore } from '../src/gateway/store';

const A = '+923001111111' as CanonicalNumber;
const B = '+923002222222' as CanonicalNumber;
const TEXT = 'take medicine';

const reminder = (id: string, number: CanonicalNumber, slot: Reminder['slot']): Reminder => ({
  id: id as ReminderId,
  number,
  slot,
  dueAt: 1_000,
  text: TEXT,
  language: 'en',
  createdAt: 0,
  handedAt: null,
});

const ok = (reminders: readonly Reminder[]): ReminderState => ({ status: 'ok', reminders });
const UNREADABLE: ReminderState = { status: 'unreadable' };

describe('store reminder count', () => {
  it('starts null and keeps the snapshot when nothing changes', () => {
    const store = createGatewayStore();
    const first = store.getSnapshot();
    expect(first.reminderCount).toBeNull();
    store.setReminderCount(null);
    expect(store.getSnapshot()).toBe(first);
  });

  it('stores 0 and above, and treats invalid counts as null', () => {
    const store = createGatewayStore();
    store.setReminderCount(0);
    expect(store.getSnapshot().reminderCount).toBe(0);
    store.setReminderCount(3);
    expect(store.getSnapshot().reminderCount).toBe(3);
    store.setReminderCount(-1);
    expect(store.getSnapshot().reminderCount).toBeNull();
    store.setReminderCount(1.5);
    expect(store.getSnapshot().reminderCount).toBeNull();
  });

  it('lists the three reminder banners after the existing ones', () => {
    expect(BANNERS.slice(-3)).toEqual([
      'reminders-unreadable',
      'reminders-save-failed',
      'reminders-may-be-late',
    ]);
  });
});

describe('showReminderStatus', () => {
  it('counts Active_Reminders across all numbers', () => {
    const ui = createGatewayStore();
    expect(reminderCountOf(EMPTY_REMINDERS)).toBe(0);
    showReminderStatus({ state: { reminders: EMPTY_REMINDERS }, ui });
    expect(ui.getSnapshot().reminderCount).toBe(0);
    const three = ok([reminder('r1', A, 1), reminder('r2', A, 2), reminder('r3', B, 1)]);
    showReminderStatus({ state: { reminders: three }, ui });
    expect(ui.getSnapshot().reminderCount).toBe(3);
    expect(ui.getSnapshot().banners).not.toContain('reminders-unreadable');
  });

  it('shows the unreadable banner and no count, then clears it once readable', () => {
    const ui = createGatewayStore();
    showReminderStatus({ state: { reminders: ok([reminder('r1', A, 1)]) }, ui });
    showReminderStatus({ state: { reminders: UNREADABLE }, ui });
    expect(ui.getSnapshot().reminderCount).toBeNull();
    expect(ui.getSnapshot().banners).toEqual(['reminders-unreadable']);
    showReminderStatus({ state: { reminders: ok([]) }, ui });
    expect(ui.getSnapshot().reminderCount).toBe(0);
    expect(ui.getSnapshot().banners).toEqual([]);
  });

  it('puts no number or Reminder_Text in the snapshot', () => {
    const ui = createGatewayStore();
    showReminderStatus({ state: { reminders: ok([reminder('r1', A, 1)]) }, ui });
    const json = JSON.stringify(ui.getSnapshot());
    expect(json).not.toContain(TEXT);
    expect(json).not.toMatch(/\d{4,}/);
  });
});

describe('showExactAlarmStatus', () => {
  const run = async (access: () => Promise<boolean>): Promise<{ banners: readonly string[]; logs: string[] }> => {
    const ui = createGatewayStore();
    const logs: string[] = [];
    await showExactAlarmStatus({ getExactAlarmAccess: access }, ui, (l) => logs.push(l));
    return { banners: ui.getSnapshot().banners, logs };
  };

  it('shows the may-be-late banner without access and hides it with access', async () => {
    expect((await run(() => Promise.resolve(false))).banners).toEqual(['reminders-may-be-late']);
    expect((await run(() => Promise.resolve(true))).banners).toEqual([]);
  });

  it('treats a failed check as no access and logs a fixed line', async () => {
    const r = await run(() => Promise.reject(new Error('boom')));
    expect(r.banners).toEqual(['reminders-may-be-late']);
    expect(r.logs).toEqual(['reminders: exact alarm access check failed']);
  });
});
