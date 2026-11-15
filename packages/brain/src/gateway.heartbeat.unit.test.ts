// Example tests for the Heartbeat_Model (Requirements 13.1, 13.2, 13.3, 18.4).
import { describe, expect, it } from 'vitest';
import { deriveHeartbeat } from './gateway.heartbeat.js';
import type { DeviceStatus, ServiceStatus, SleepReason } from './gateway.types.js';

const healthy: DeviceStatus = {
  smsPermission: true,
  notificationPermission: true,
  batteryOptimisationIgnored: true,
  inService: true,
  airplaneMode: false,
};

const allBroken: DeviceStatus = {
  smsPermission: false,
  notificationPermission: false,
  batteryOptimisationIgnored: false,
  inService: false,
  airplaneMode: true,
};

interface ReasonCase {
  readonly reason: SleepReason;
  readonly device: DeviceStatus;
  readonly service: ServiceStatus;
}

/** One input per Sleep_Reason where only that reason applies (13.13, 13.14). */
const REASON_CASES: readonly ReasonCase[] = [
  { reason: 'paused-by-operator', device: healthy, service: 'paused' },
  { reason: 'no-sms-permission', device: { ...healthy, smsPermission: false }, service: 'running' },
  {
    reason: 'no-notification-permission',
    device: { ...healthy, notificationPermission: false },
    service: 'running',
  },
  { reason: 'service-stopped', device: healthy, service: 'stopped' },
  { reason: 'airplane-mode', device: { ...healthy, airplaneMode: true }, service: 'running' },
  { reason: 'no-signal', device: { ...healthy, inService: false }, service: 'running' },
  {
    reason: 'battery-optimised',
    device: { ...healthy, batteryOptimisationIgnored: false },
    service: 'running',
  },
];

describe('Heartbeat_Model: no Sleep_Reason (13.1, 13.2)', () => {
  it('returns ALIVE when running, healthy and not sending', () => {
    expect(deriveHeartbeat(healthy, 'running', false)).toEqual({ state: 'ALIVE' });
  });

  it('returns SENDING when running, healthy and sending a multipart SMS', () => {
    expect(deriveHeartbeat(healthy, 'running', true)).toEqual({ state: 'SENDING' });
  });
});

describe('Heartbeat_Model: each Sleep_Reason (13.3, 18.4)', () => {
  it.each(REASON_CASES)('returns SLEEPING with $reason', ({ reason, device, service }) => {
    expect(deriveHeartbeat(device, service, false)).toEqual({ state: 'SLEEPING', reason });
  });

  it.each(REASON_CASES)('returns SLEEPING with $reason even while sending', ({ reason, device, service }) => {
    expect(deriveHeartbeat(device, service, true)).toEqual({ state: 'SLEEPING', reason });
  });

  it('reports airplane-mode, not no-signal, when airplane mode is on and out of service', () => {
    const device: DeviceStatus = { ...healthy, airplaneMode: true, inService: false };
    expect(deriveHeartbeat(device, 'running', false)).toEqual({ state: 'SLEEPING', reason: 'airplane-mode' });
  });
});

describe('Heartbeat_Model: priority order (13.3)', () => {
  it('picks paused-by-operator first when every reason applies', () => {
    expect(deriveHeartbeat(allBroken, 'paused', true)).toEqual({
      state: 'SLEEPING',
      reason: 'paused-by-operator',
    });
  });

  it('picks no-sms-permission over the remaining reasons when stopped', () => {
    expect(deriveHeartbeat(allBroken, 'stopped', true)).toEqual({
      state: 'SLEEPING',
      reason: 'no-sms-permission',
    });
  });
});
