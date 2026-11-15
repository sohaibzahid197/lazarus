// Feature: crypt-ouija-simulator, Property 12: Session_Snapshot round trip
import fc from 'fast-check';
import type { GatewayState } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import { snapshotAtArb } from '../test/arbitraries/snapshot';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { parseSnapshot } from './snapshot.parse';
import { printSnapshot } from './snapshot.print';
import { SIMULATOR_NUMBER } from './simulatorNumber';

/** Parses at `serverTime` and fails the test when the parser rejects the value. */
function parseOk(value: unknown, serverTime: number): GatewayState {
  const result = parseSnapshot(value, serverTime, SIMULATOR_NUMBER);
  if (!result.ok) throw new Error(`parseSnapshot rejected a valid snapshot: ${result.error}`);
  return result.state;
}

/** Every Stop_List, rate, slow-down and Reminder entry uses the Simulator_Number (8.2). */
function expectOnlySimulatorNumber(state: GatewayState): void {
  for (const n of state.stopList) expect(n).toBe(SIMULATOR_NUMBER);
  for (const n of state.rate.keys()) expect(n).toBe(SIMULATOR_NUMBER);
  for (const n of state.slowDown.keys()) expect(n).toBe(SIMULATOR_NUMBER);
  expect(state.reminders.status).toBe('ok');
  if (state.reminders.status === 'ok') {
    for (const r of state.reminders.reminders) expect(r.number).toBe(SIMULATOR_NUMBER);
  }
}

describe('Session_Snapshot round trip', () => {
  /**
   * **Validates: Requirements 8.2, 8.3, 8.8**
   */
  it('Feature: crypt-ouija-simulator, Property 12: Session_Snapshot round trip', () => {
    fc.assert(
      fc.property(snapshotAtArb, ({ serverTime, snapshot }) => {
        const first = parseOk(snapshot, serverTime);
        const printed = printSnapshot(first, SIMULATOR_NUMBER);
        // Through JSON, as the snapshot travels to the browser and back.
        const second = parseOk(JSON.parse(JSON.stringify(printed)), serverTime);

        expect(second).toEqual(first);
        expectOnlySimulatorNumber(first);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
