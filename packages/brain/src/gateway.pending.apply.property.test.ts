import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildActivityEntry } from './gateway.activity.js';
import {
  GATEWAY_PBT_OPTIONS,
  canonicalNumber,
  canonicalNumberIn,
  countryCode,
  gatewayState,
  pendingStopRecord,
} from './gateway.arbitraries.js';
import { maskNumber, maskSender, normalizeSender } from './gateway.number.js';
import { applyPendingStop, type PendingStopRecord } from './gateway.pending.js';
import { applyChanges } from './gateway.pipeline.js';
import type { CanonicalNumber, GatewayState } from './gateway.types.js';

interface Scenario {
  readonly record: PendingStopRecord;
  readonly state: GatewayState;
}

/**
 * Any Gateway_State whose Default_Country_Code and Own_Number match the
 * record arbitrary, so the sender is an Automated_Sender, a formatting of the
 * Own_Number, or another Phone_Number. The state's lists may hold the Own_Number.
 */
const scenario: fc.Arbitrary<Scenario> = countryCode.chain((cc) =>
  fc
    .option(fc.oneof(canonicalNumberIn(cc), canonicalNumber), { nil: null })
    .chain((ownNumber: CanonicalNumber | null) =>
      fc
        .tuple(pendingStopRecord(ownNumber, cc), gatewayState(ownNumber === null ? [] : [ownNumber]))
        .map(([record, s]) => ({
          record,
          state: { ...s, settings: { ...s.settings, defaultCountryCode: cc, ownNumber } },
        })),
    ),
);

describe('gateway.pending applyPendingStop', () => {
  // Feature: necromancer-sms-gateway, Property 37: Applying a Pending_Stop_Record
  it('applies a Pending_Stop_Record in any state (Requirements 9.15, 3.2, 7.1, 7.2)', () => {
    /** **Validates: Requirements 9.15, 3.2, 7.1, 7.2** */
    fc.assert(
      fc.property(scenario, ({ record, state }) => {
        const identity = normalizeSender(record.sender, state.settings.defaultCountryCode);
        const decision = applyPendingStop(record, state);

        expect(decision.command).toBe('STOP');
        expect(decision.parts).toEqual([]);
        expect(decision.receivedAt).toBe(record.receivedAt);

        const next = applyChanges(state, decision.changes);
        const entry = buildActivityEntry(decision, decision.outcome);
        expect(entry.receivedAt).toBe(record.receivedAt);
        expect(entry.command).toBe('STOP');

        if (identity.kind === 'automated') {
          expect(decision.outcome).toBe('ignored-automated');
          expect(decision.changes).toEqual([]);
          expect(entry.who).toBe(maskSender(record.sender));
        } else if (identity.number === state.settings.ownNumber) {
          expect(decision.outcome).toBe('ignored-own-number');
          expect(decision.changes).toEqual([]);
          expect(entry.who).toBe(maskNumber(identity.number));
        } else {
          expect(decision.outcome).toBe('stopped');
          expect(decision.changes).toEqual([{ type: 'stop-add', number: identity.number }]);
          expect(entry.who).toBe(maskNumber(identity.number));
          expect([...next.stopList].filter((n) => n === identity.number)).toHaveLength(1);
        }

        const expectedStop =
          decision.outcome === 'stopped' && identity.kind === 'phone'
            ? new Set([...state.stopList, identity.number])
            : new Set(state.stopList);
        expect(new Set(next.stopList)).toEqual(expectedStop);
        expect(next.allowlist).toEqual(state.allowlist);
        expect(next.rate).toEqual(state.rate);
        expect(next.slowDown).toEqual(state.slowDown);
        expect(next.counters).toEqual(state.counters);
        expect(next.settings).toEqual(state.settings);
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
