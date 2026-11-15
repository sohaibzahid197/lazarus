// Feature: necromancer-sms-gateway, Property 24: Heartbeat invariant
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GATEWAY_PBT_OPTIONS, deviceStatus } from './gateway.arbitraries.js';
import { deriveHeartbeat } from './gateway.heartbeat.js';
import { SLEEP_REASONS } from './gateway.types.js';
import type { ServiceStatus } from './gateway.types.js';

const serviceStatus: fc.Arbitrary<ServiceStatus> = fc.constantFrom('running', 'stopped', 'paused');
const STATES: readonly string[] = ['ALIVE', 'SLEEPING', 'SENDING'];

describe('deriveHeartbeat invariant', () => {
  /** **Validates: Requirements 13.4** */
  it('Req 13.4: state is one of ALIVE/SLEEPING/SENDING and has a Sleep_Reason iff SLEEPING', () => {
    fc.assert(
      fc.property(deviceStatus, serviceStatus, fc.boolean(), (device, service, sending) => {
        const hb = deriveHeartbeat(device, service, sending);
        expect(STATES).toContain(hb.state);
        const reason: unknown = 'reason' in hb ? hb.reason : undefined;
        if (hb.state === 'SLEEPING') {
          expect(SLEEP_REASONS as readonly unknown[]).toContain(reason);
        } else {
          expect(reason).toBeUndefined();
        }
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
