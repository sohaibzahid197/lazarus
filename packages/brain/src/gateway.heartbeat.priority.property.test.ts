// Feature: necromancer-sms-gateway, Property 25: Heartbeat matches the priority table
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GATEWAY_PBT_OPTIONS, deviceStatus } from './gateway.arbitraries.js';
import { deriveHeartbeat } from './gateway.heartbeat.js';
import type { DeviceStatus, Heartbeat, ServiceStatus } from './gateway.types.js';

const serviceStatus: fc.Arbitrary<ServiceStatus> = fc.constantFrom('running', 'stopped', 'paused');

/**
 * Independent reference model of Requirement 13.1-13.3, 13.13 and 13.14,
 * written as an if-chain in the stated priority order.
 */
function referenceHeartbeat(d: DeviceStatus, service: ServiceStatus, sending: boolean): Heartbeat {
  if (service === 'paused') return { state: 'SLEEPING', reason: 'paused-by-operator' };
  if (!d.smsPermission) return { state: 'SLEEPING', reason: 'no-sms-permission' };
  if (!d.notificationPermission) return { state: 'SLEEPING', reason: 'no-notification-permission' };
  if (service === 'stopped') return { state: 'SLEEPING', reason: 'service-stopped' };
  if (d.airplaneMode) return { state: 'SLEEPING', reason: 'airplane-mode' };
  if (!d.inService) return { state: 'SLEEPING', reason: 'no-signal' };
  if (!d.batteryOptimisationIgnored) return { state: 'SLEEPING', reason: 'battery-optimised' };
  if (sending) return { state: 'SENDING' };
  return { state: 'ALIVE' };
}

describe('deriveHeartbeat priority table', () => {
  /** **Validates: Requirements 13.1, 13.2, 13.3, 13.13, 13.14** */
  it('Req 13.1, 13.2, 13.3, 13.13, 13.14: matches the reference priority table', () => {
    fc.assert(
      fc.property(deviceStatus, serviceStatus, fc.boolean(), (device, service, sending) => {
        expect(deriveHeartbeat(device, service, sending)).toEqual(
          referenceHeartbeat(device, service, sending),
        );
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
