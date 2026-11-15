// Self-test for the recording GatewayPorts mock (Requirement 18.11).
import {
  encodeReminder,
  type ActivityEntry,
  type CanonicalNumber,
  type Reminder,
  type ReminderId,
} from '@lazarus/brain';
import { allSent, createMockPorts, emptyState, inbound } from './support/mockPorts';

const NUMBER = '+923001234567' as CanonicalNumber;
const ENTRY: ActivityEntry = { receivedAt: 1, who: '••••567', command: 'STOP', outcome: 'stopped' };
const REMINDER: Reminder = {
  id: 'r1' as ReminderId,
  number: NUMBER,
  slot: 1,
  dueAt: 5_000,
  text: 'take medicine',
  language: 'en',
  createdAt: 1_000,
  handedAt: null,
};

describe('mockPorts', () => {
  it('uses healthy defaults', async () => {
    const m = createMockPorts();
    const { gateway, store, keyStore } = m.ports;
    expect(await store.loadState('2026-01-15')).toEqual(emptyState('2026-01-15'));
    expect((await store.loadState('2026-01-15')).status).toBe('ok');
    expect(await keyStore.readKey()).toMatchObject({ status: 'present' });
    expect(await gateway.sendParts('s1', NUMBER, ['a', 'b'])).toEqual(allSent(2));
    expect(await gateway.takeNextInbound()).toBeNull();
  });

  it('plays scripted steps in order, then falls back to the default', async () => {
    const m = createMockPorts();
    m.scripts.loadState.reject('db locked').resolve({ status: 'unreadable' });
    m.scripts.readKey.resolve({ status: 'unreadable' }).reject('keystore gone');
    m.scripts.commit.reject('disk full', 2);
    const { store, keyStore } = m.ports;

    await expect(store.loadState('d')).rejects.toThrow('db locked');
    expect(await store.loadState('d')).toEqual({ status: 'unreadable' });
    expect((await store.loadState('d')).status).toBe('ok');

    expect(await keyStore.readKey()).toEqual({ status: 'unreadable' });
    await expect(keyStore.readKey()).rejects.toThrow('keystore gone');

    await expect(store.commit([])).rejects.toThrow('disk full');
    await expect(store.commit([])).rejects.toThrow('disk full');
    await expect(store.commit([])).resolves.toBeUndefined();

    m.scripts.appendActivity.alwaysReject();
    await expect(store.appendActivity(ENTRY)).rejects.toThrow();
    await expect(store.appendActivity(ENTRY)).rejects.toThrow();
  });

  it('keeps a pending stop until applyPendingStop succeeds', async () => {
    const m = createMockPorts();
    const id = m.addPendingStop('+923001234567', 5);
    m.scripts.applyPendingStop.reject('locked').resolve(false);
    const { gateway, store } = m.ports;

    await expect(store.applyPendingStop(id, [], ENTRY)).rejects.toThrow('locked');
    expect(await store.applyPendingStop(id, [], ENTRY)).toBe(false);
    expect(await gateway.takePendingStops()).toHaveLength(1);
    expect(await store.applyPendingStop(id, [], ENTRY)).toBe(true);
    expect(await gateway.takePendingStops()).toEqual([]);

    await store.savePendingStop('+923009999999', 9);
    expect(m.pendingStops).toEqual([
      { id: 2, sender: '+923009999999', marker: 'STOP', receivedAt: 9 },
    ]);
  });

  it('hands out inbound messages and wakes a waiting loop', async () => {
    const m = createMockPorts();
    const { gateway } = m.ports;
    let woke = false;
    const waiting = gateway.waitForInbound().then(() => {
      woke = true;
    });
    await m.settle();
    expect(woke).toBe(false);

    const heard: number[] = [];
    const off = gateway.onInboundAvailable(() => heard.push(1));
    m.pushInbound(inbound('m1', '+923001234567', 'hello'));
    await waiting;
    expect(woke).toBe(true);
    expect(heard).toEqual([1]);
    off();
    m.emitInboundAvailable();
    expect(heard).toEqual([1]);

    expect(await gateway.takeNextInbound()).toMatchObject({ id: 'm1', body: 'hello' });
    expect(await gateway.takeNextInbound()).toBeNull();
  });

  it('loads a readable Reminder_Store, empty by default or with the given wire entries', async () => {
    const empty = emptyState('2026-01-15');
    expect(empty.status === 'ok' && empty.state.reminders).toEqual({ status: 'ok', reminders: [] });
    const one = emptyState('2026-01-15', [encodeReminder(REMINDER)]);
    expect(one.status === 'ok' && one.state.reminders).toEqual({ status: 'ok', reminders: [REMINDER] });

    const m = createMockPorts();
    m.scripts.loadState.resolve(one);
    expect(await m.ports.store.loadState('2026-01-15')).toEqual(one);
  });

  it('records reminders port calls and delivers onRemindersDue until unsubscribed', async () => {
    const m = createMockPorts();
    const { reminders } = m.ports;
    expect(await reminders.getExactAlarmAccess()).toBe(true);
    m.scripts.getExactAlarmAccess.resolve(false);
    expect(await reminders.getExactAlarmAccess()).toBe(false);
    await expect(reminders.reschedule()).resolves.toBeUndefined();
    m.scripts.scheduleRetry.reject('alarm manager gone');
    await expect(reminders.scheduleRetry()).rejects.toThrow('alarm manager gone');
    await reminders.openExactAlarmSettings();

    let due = 0;
    const off = reminders.onRemindersDue(() => {
      due++;
    });
    expect(m.remindersDueListenerCount()).toBe(1);
    m.emitRemindersDue();
    off();
    m.emitRemindersDue();
    expect(due).toBe(1);
    expect(m.remindersDueListenerCount()).toBe(0);

    expect(m.names()).toEqual([
      'getExactAlarmAccess',
      'getExactAlarmAccess',
      'reschedule',
      'scheduleRetry',
      'openExactAlarmSettings',
      'onRemindersDue',
    ]);
    expect(m.calls.every((c) => c.port === 'reminders')).toBe(true);
  });

  it('records an ordered call log with arguments', async () => {
    const m = createMockPorts();
    const { gateway, store, keyStore, device } = m.ports;
    const statuses: unknown[] = [];
    device.onDeviceStatus((s) => statuses.push(s));

    await store.loadState('d');
    await keyStore.readKey();
    await gateway.takePendingStops();
    gateway.attachLoop();
    await gateway.takeNextInbound();
    await gateway.sendParts('s1', NUMBER, ['body text']);
    await store.commit([{ type: 'stop-add', number: NUMBER }]);
    await gateway.completeInbound('m1');
    m.emitDeviceStatus(null);

    expect(m.names(['loadState', 'readKey', 'takePendingStops', 'attachLoop', 'takeNextInbound'])).toEqual(
      ['loadState', 'readKey', 'takePendingStops', 'attachLoop', 'takeNextInbound'],
    );
    expect(m.names().slice(-3)).toEqual(['sendParts', 'commit', 'completeInbound']);
    expect(m.callsTo('sendParts')[0]).toEqual({
      port: 'gateway',
      method: 'sendParts',
      args: ['s1', NUMBER, ['body text']],
    });
    expect(m.callsTo('commit')[0].args).toEqual([[{ type: 'stop-add', number: NUMBER }]]);
    expect(statuses).toEqual([null]);

    m.clearCalls();
    expect(m.calls).toEqual([]);
  });
});
