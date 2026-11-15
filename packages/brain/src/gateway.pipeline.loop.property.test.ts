import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GATEWAY_PBT_OPTIONS,
  anyBody,
  automatedAddress,
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
import type { GatewayState, InboundMessage } from './gateway.types.js';
import { routeCommand } from './router.js';
import type { RoutedCommand } from './router.types.js';

/** routeCommand wrapped with a call counter. */
function countingRoute(): { route: (input: string) => RoutedCommand; calls: () => number } {
  let count = 0;
  return {
    route: (input) => {
      count += 1;
      return routeCommand(input);
    },
    calls: () => count,
  };
}

/** Any body, with STOP forms weighted in. */
const bodyArb: fc.Arbitrary<string> = fc.oneof(anyBody, stopAliasBody);

function expectStateUnchanged(state: GatewayState, next: GatewayState): void {
  expect(next.stopList).toEqual(state.stopList);
  expect(next.allowlist).toEqual(state.allowlist);
  expect(next.rate).toEqual(state.rate);
  expect(next.slowDown).toEqual(state.slowDown);
  expect(next.counters).toEqual(state.counters);
  expect(next.settings).toEqual(state.settings);
}

/** A Gateway_State with an Own_Number set and an address that formats it for the state's country code. */
const ownNumberScenario: fc.Arbitrary<{ state: GatewayState; address: string }> = countryCode
  .chain((cc) =>
    fc.oneof(canonicalNumberIn(cc), canonicalNumber).chain((own) =>
      fc.tuple(gatewayState([own]), formattingOf(own, cc)).map(([s, f]) => ({
        address: f.address,
        state: {
          ...s,
          settings: { ...s.settings, defaultCountryCode: cc, ownNumber: own },
        },
      })),
    ),
  );

describe('gateway.pipeline loop protection', () => {
  // Feature: necromancer-sms-gateway, Property 20: Automated senders and the Own_Number are ignored
  it('ignores Automated_Senders whatever the body (Requirements 7.1, 7.2)', () => {
    /** **Validates: Requirements 7.1, 7.2** */
    fc.assert(
      fc.property(
        gatewayState(),
        automatedAddress,
        bodyArb,
        fc.boolean(),
        dayKeyArb,
        timeArb,
        (state, sender, body, aiAvailable, today, receivedAt) => {
          const msg: InboundMessage = { id: 'm1', seq: 1, sender, body, receivedAt };
          const counter = countingRoute();
          const step = evaluateInbound(msg, state, { paused: false, today }, counter.route, aiAvailable);
          expect(step.kind).toBe('final');
          if (step.kind !== 'final') return;
          const { decision } = step;
          expect(decision.outcome).toBe('ignored-automated');
          expect(decision.parts).toEqual([]);
          expect(decision.changes).toEqual([]);
          expect(decision.command).toBeNull();
          expect(counter.calls()).toBe(0);
          expectStateUnchanged(state, applyChanges(state, decision.changes));
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
  });

  // Feature: necromancer-sms-gateway, Property 20: Automated senders and the Own_Number are ignored
  it('ignores any formatting of the Own_Number whatever the body (Requirements 7.1, 7.2)', () => {
    /** **Validates: Requirements 7.1, 7.2** */
    fc.assert(
      fc.property(
        ownNumberScenario,
        bodyArb,
        fc.boolean(),
        dayKeyArb,
        timeArb,
        ({ state, address }, body, aiAvailable, today, receivedAt) => {
          const msg: InboundMessage = { id: 'm1', seq: 1, sender: address, body, receivedAt };
          const counter = countingRoute();
          const step = evaluateInbound(msg, state, { paused: false, today }, counter.route, aiAvailable);
          expect(step.kind).toBe('final');
          if (step.kind !== 'final') return;
          const { decision } = step;
          expect(decision.outcome).toBe('ignored-own-number');
          expect(decision.parts).toEqual([]);
          expect(decision.changes).toEqual([]);
          expect(decision.command).toBeNull();
          expect(counter.calls()).toBe(0);
          expectStateUnchanged(state, applyChanges(state, decision.changes));
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
