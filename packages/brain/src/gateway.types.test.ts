import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  OUTCOMES,
  SLEEP_REASONS,
  type GatewayDecision,
  type Heartbeat,
  type StateChange,
} from './gateway.types.js';

describe('gateway.types', () => {
  it('OUTCOMES lists the 11 distinct outcomes (Requirement 7.4)', () => {
    expect(OUTCOMES).toHaveLength(11);
    expect(new Set(OUTCOMES).size).toBe(11);
  });

  it('SLEEP_REASONS keeps the priority order (Requirement 13.3)', () => {
    expect(SLEEP_REASONS).toEqual([
      'paused-by-operator',
      'no-sms-permission',
      'no-notification-permission',
      'service-stopped',
      'airplane-mode',
      'no-signal',
      'battery-optimised',
    ]);
  });

  it('Heartbeat carries a reason only when SLEEPING (Requirement 13.4)', () => {
    expectTypeOf<Extract<Heartbeat, { state: 'ALIVE' }>>().not.toHaveProperty('reason');
    expectTypeOf<Extract<Heartbeat, { state: 'SENDING' }>>().not.toHaveProperty('reason');
    expectTypeOf<Extract<Heartbeat, { state: 'SLEEPING' }>>().toHaveProperty('reason');
  });

  it('GatewayDecision and StateChange have no body field (Requirement 14.7)', () => {
    expectTypeOf<GatewayDecision>().not.toHaveProperty('body');
    expectTypeOf<StateChange>().not.toHaveProperty('body');
  });
});
