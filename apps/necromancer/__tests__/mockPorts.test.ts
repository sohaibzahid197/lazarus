// Self-test for the recording GatewayPorts mock (Requirement 18.11).
import type { ActivityEntry, CanonicalNumber } from '@lazarus/brain';
import { allSent, createMockPorts, emptyState, inbound } from './support/mockPorts';

const NUMBER = '+923001234567' as CanonicalNumber;
const ENTRY: ActivityEntry = { receivedAt: 1, who: '••••567', command: 'STOP', outcome: 'stopped' };

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
