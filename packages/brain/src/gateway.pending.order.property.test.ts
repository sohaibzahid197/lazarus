// Property test for Pending_Stop_Record ordering (task 10.3).
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GATEWAY_PBT_OPTIONS, gatewayState, pendingStopRecord, timeArb } from './gateway.arbitraries.js';
import { normalizeSender } from './gateway.number.js';
import { applyPendingStop, orderPendingStops, type PendingStopRecord } from './gateway.pending.js';
import { applyChanges } from './gateway.pipeline.js';
import type { CanonicalNumber, GatewayState } from './gateway.types.js';

interface Scenario {
  readonly state: GatewayState;
  readonly records: readonly PendingStopRecord[];
  readonly shuffled: readonly PendingStopRecord[];
}

/** A state, records with unique ids and many receivedAt ties, and a shuffle of them. */
const scenario: fc.Arbitrary<Scenario> = gatewayState().chain((state) => {
  const { ownNumber, defaultCountryCode } = state.settings;
  return fc
    .tuple(
      fc.array(timeArb, { minLength: 1, maxLength: 3 }),
      fc.array(pendingStopRecord(ownNumber, defaultCountryCode), { maxLength: 12 }),
      fc.uniqueArray(fc.nat(), { minLength: 12, maxLength: 12 }),
    )
    .chain(([times, raw, ids]) =>
      fc
        .tuple(...raw.map(() => fc.constantFrom(...times)))
        .map((picked) => raw.map((r, i) => ({ ...r, id: ids[i] as number, receivedAt: picked[i] as number }))),
    )
    .chain((records) =>
      fc
        .shuffledSubarray(records, { minLength: records.length, maxLength: records.length })
        .map((shuffled) => ({ state, records, shuffled })),
    );
});

function fold(records: readonly PendingStopRecord[], start: GatewayState) {
  const decisions = [];
  let state = start;
  for (const record of orderPendingStops(records)) {
    const decision = applyPendingStop(record, state);
    decisions.push(decision);
    state = applyChanges(state, decision.changes);
  }
  return { state, decisions };
}

function expectedStopList(s: Scenario): Set<CanonicalNumber> {
  const expected = new Set(s.state.stopList);
  for (const r of s.records) {
    const id = normalizeSender(r.sender, s.state.settings.defaultCountryCode);
    if (id.kind === 'phone' && id.number !== s.state.settings.ownNumber) expected.add(id.number);
  }
  return expected;
}

const byKey = (a: PendingStopRecord, b: PendingStopRecord): number =>
  a.receivedAt - b.receivedAt || a.id - b.id;

describe('gateway.pending ordering', () => {
  // Feature: necromancer-sms-gateway, Property 38: Pending_Stop_Records are applied in receive-time order
  // **Validates: Requirements 9.15**
  it('Property 38: orders by (receivedAt, id) and folds to the expected Stop_List (Req 9.15)', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const snapshot = s.shuffled.map((r) => ({ ...r }));
        const ordered = orderPendingStops(s.shuffled);

        // Input unchanged; output is a sorted permutation.
        expect(s.shuffled).toEqual(snapshot);
        expect(ordered).toHaveLength(s.shuffled.length);
        expect([...ordered].sort(byKey)).toEqual([...s.records].sort(byKey));
        for (let i = 1; i < ordered.length; i++) {
          expect(byKey(ordered[i - 1] as PendingStopRecord, ordered[i] as PendingStopRecord)).toBeLessThan(0);
        }

        // Fold gives the expected Stop_List regardless of input permutation.
        const fromShuffled = fold(s.shuffled, s.state);
        const fromOriginal = fold(s.records, s.state);
        const expected = expectedStopList(s);
        expect(new Set(fromShuffled.state.stopList)).toEqual(expected);
        expect(new Set(fromOriginal.state.stopList)).toEqual(expected);
        expect(fromShuffled.decisions).toEqual(fromOriginal.decisions);

        // Decisions are made in non-decreasing receive time.
        const times = fromShuffled.decisions.map((d) => d.receivedAt);
        for (let i = 1; i < times.length; i++) {
          expect(times[i] as number).toBeGreaterThanOrEqual(times[i - 1] as number);
        }
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
