// Unit tests for the UI store (task 22.4; Requirements 5.9, 13.6, 13.11, 13.12).
import { ACTIVITY_LOG_MAX, zeroCounters } from '@lazarus/brain';
import type { ActivityEntry, DeviceStatus } from '@lazarus/brain';
import { createGatewayStore, gatewayStore } from '../src/gateway/store';

const DEVICE: DeviceStatus = {
  smsPermission: true,
  notificationPermission: true,
  batteryOptimisationIgnored: true,
  inService: true,
  airplaneMode: false,
};

const entry = (receivedAt: number): ActivityEntry => ({
  receivedAt,
  who: '••••••••••567',
  command: 'HELP',
  outcome: 'replied',
});

describe('gateway UI store', () => {
  it('starts empty and exposes a singleton', () => {
    const s = createGatewayStore().getSnapshot();
    expect(s).toEqual({
      deviceStatus: null,
      serviceStatus: 'stopped',
      sending: false,
      counters: null,
      banners: [],
      activity: [],
      inboundPulse: 0,
    });
    expect(typeof gatewayStore.subscribe).toBe('function');
  });

  it('changes snapshot identity only when something changes', () => {
    const store = createGatewayStore();
    const s0 = store.getSnapshot();
    store.setServiceStatus('stopped');
    store.setSending(false);
    store.clearActivity();
    store.setBanner('cap-reached', false);
    expect(store.getSnapshot()).toBe(s0);

    store.setServiceStatus('running');
    const s1 = store.getSnapshot();
    expect(s1).not.toBe(s0);
    expect(s1.serviceStatus).toBe('running');
    expect(s0.serviceStatus).toBe('stopped');

    store.setDeviceStatus(DEVICE);
    const s2 = store.getSnapshot();
    store.setDeviceStatus({ ...DEVICE });
    expect(store.getSnapshot()).toBe(s2);
    store.setDeviceStatus({ ...DEVICE, inService: false });
    expect(store.getSnapshot()).not.toBe(s2);

    store.setCounters(zeroCounters('2026-11-09'));
    const s3 = store.getSnapshot();
    store.setCounters(zeroCounters('2026-11-09'));
    expect(store.getSnapshot()).toBe(s3);
    store.setCounters({ ...zeroCounters('2026-11-09'), received: 1 });
    expect(store.getSnapshot().counters?.received).toBe(1);
  });

  it('notifies subscribers until they unsubscribe', () => {
    const store = createGatewayStore();
    const calls: number[] = [];
    const off = store.subscribe(() => calls.push(store.getSnapshot().inboundPulse));
    store.pulseInbound();
    store.pulseInbound();
    store.setSending(false); // no change, no call
    off();
    store.pulseInbound();
    expect(calls).toEqual([1, 2]);
    expect(store.getSnapshot().inboundPulse).toBe(3);
  });

  it('sets and clears banners in a fixed order', () => {
    const store = createGatewayStore();
    store.setBanner('ai-key-missing', true);
    store.setBanner('stop-list-unreadable', true);
    store.setBanner('ai-key-missing', true);
    expect(store.getSnapshot().banners).toEqual(['stop-list-unreadable', 'ai-key-missing']);
    store.setBanner('stop-list-unreadable', false);
    expect(store.getSnapshot().banners).toEqual(['ai-key-missing']);
  });

  it('keeps the last device status when it becomes unreadable (13.15)', () => {
    const store = createGatewayStore();
    store.setDeviceStatus(DEVICE);
    store.markDeviceStatusUnreadable();
    expect(store.getSnapshot().deviceStatus).toEqual(DEVICE);
    expect(store.getSnapshot().banners).toEqual(['phone-status-unreadable']);
    store.setDeviceStatus(DEVICE);
    expect(store.getSnapshot().banners).toEqual([]);
  });

  it('keeps activity newest first and trims to the maximum', () => {
    const store = createGatewayStore();
    for (let t = 1; t <= ACTIVITY_LOG_MAX + 5; t++) store.addActivity(entry(t));
    const list = store.getSnapshot().activity;
    expect(list).toHaveLength(ACTIVITY_LOG_MAX);
    expect(list[0].receivedAt).toBe(ACTIVITY_LOG_MAX + 5);
    expect(list[ACTIVITY_LOG_MAX - 1].receivedAt).toBe(6);

    store.setActivity([entry(1), entry(9), entry(5)]);
    expect(store.getSnapshot().activity.map((e) => e.receivedAt)).toEqual([9, 5, 1]);
    store.clearActivity();
    expect(store.getSnapshot().activity).toEqual([]);
  });
});
