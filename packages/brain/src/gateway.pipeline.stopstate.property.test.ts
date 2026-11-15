import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GATEWAY_PBT_OPTIONS,
  canonicalNumber,
  canonicalNumberIn,
  countryCode,
  dayKeyArb,
  formattingOf,
  gatewayState,
  stopAliasBody,
  timeArb,
} from './gateway.arbitraries.js';
import { applyChanges, evaluateInbound } from './gateway.pipeline.js';
import type { CanonicalNumber, GatewayState, InboundMessage } from './gateway.types.js';
import { routeCommand } from './router.js';

interface Scenario {
  readonly number: CanonicalNumber;
  readonly address: string;
  readonly state: GatewayState;
}

/**
 * A Gateway_State whose lists draw on the sender's Canonical_Number, with the
 * Default_Country_Code set so the address normalizes back to that number.
 * The number is never the Own_Number.
 */
const scenario: fc.Arbitrary<Scenario> = countryCode
  .chain((cc) =>
    fc.oneof(canonicalNumberIn(cc), canonicalNumber).chain((number) =>
      fc
        .tuple(gatewayState([number]), formattingOf(number, cc))
        .map(([s, f]) => ({
          number,
          address: f.address,
          state: { ...s, settings: { ...s.settings, defaultCountryCode: cc } },
        })),
    ),
  )
  .filter((s) => s.state.settings.ownNumber !== s.number);

describe('gateway.pipeline STOP in every state', () => {
  // Feature: necromancer-sms-gateway, Property 7: STOP is recorded in every state
  it('records STOP once in any state, paused or not (Requirements 3.1, 3.2, 9.11)', () => {
    /** **Validates: Requirements 3.1, 3.2, 9.11** */
    fc.assert(
      fc.property(
        scenario,
        stopAliasBody,
        fc.boolean(),
        fc.boolean(),
        dayKeyArb,
        timeArb,
        ({ number, address, state }, body, paused, aiAvailable, today, receivedAt) => {
          const msg: InboundMessage = { id: 'm1', seq: 1, sender: address, body, receivedAt };
          const step = evaluateInbound(msg, state, { paused, today }, routeCommand, aiAvailable);
          expect(step.kind).toBe('final');
          if (step.kind !== 'final') return;
          const { decision } = step;
          expect(decision.outcome).toBe('stopped');
          expect(decision.parts).toEqual([]);
          expect(decision.changes).toEqual([
            { type: 'stop-add', number },
            { type: 'reminder-remove-all', number },
          ]);

          const next = applyChanges(state, decision.changes);
          expect([...next.stopList].filter((n) => n === number)).toHaveLength(1);
          expect(new Set(next.stopList)).toEqual(new Set([...state.stopList, number]));
          expect(next.allowlist).toEqual(state.allowlist);
          expect(next.rate).toEqual(state.rate);
          expect(next.slowDown).toEqual(state.slowDown);
          expect(next.counters).toEqual(state.counters);
          expect(next.settings).toEqual(state.settings);
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
