// Feature: crypt-ouija-simulator, Property 13: Invalid snapshots are rejected
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { messageBodyArb } from '../test/arbitraries/request';
import { snapshotViolationAtArb } from '../test/arbitraries/snapshot';
import { makeHandler, post } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { REAL_BRAIN, type BrainFns } from './brainFns';
import { parseSnapshot } from './snapshot.parse';
import { SIMULATOR_NUMBER } from './simulatorNumber';

interface BrainCalls {
  pipeline: number;
  decide: number;
}

/** The real brain functions, with call counters on the two entry points. */
function countingBrain(calls: BrainCalls): Partial<BrainFns> {
  return {
    runGatewayPipeline: (...args) => {
      calls.pipeline += 1;
      return REAL_BRAIN.runGatewayPipeline(...args);
    },
    decideDelivery: (...args) => {
      calls.decide += 1;
      return REAL_BRAIN.decideDelivery(...args);
    },
  };
}

/** A `message` or `deliver` request that is valid apart from its snapshot. */
const requestShellArb: fc.Arbitrary<{ readonly type: 'message'; readonly body: string } | { readonly type: 'deliver'; readonly reminderId: string }> =
  fc.oneof(
    messageBodyArb.map((body) => ({ type: 'message' as const, body })),
    fc.string({ minLength: 1, maxLength: 64 }).map((reminderId) => ({ type: 'deliver' as const, reminderId })),
  );

describe('Invalid snapshots are rejected', () => {
  /**
   * **Validates: Requirements 8.4**
   */
  it('Feature: crypt-ouija-simulator, Property 13: Invalid snapshots are rejected', async () => {
    await fc.assert(
      fc.asyncProperty(snapshotViolationAtArb, requestShellArb, async ({ serverTime, violation }, shell) => {
        // The parser names the broken rule.
        const parsed = parseSnapshot(violation.snapshot, serverTime, SIMULATOR_NUMBER);
        expect(parsed).toEqual({ ok: false, error: violation.rule });

        // The handler answers a bare 400 and never reaches the brain.
        const calls: BrainCalls = { pipeline: 0, decide: 0 };
        const h = makeHandler({ now: serverTime, brain: countingBrain(calls) });
        const res = await post(h.handler, { ...shell, snapshot: violation.snapshot });

        expect(res.status).toBe(400);
        expect(res.json).toEqual({ error: 'invalid-snapshot' });
        expect(calls).toEqual({ pipeline: 0, decide: 0 });
        expect(h.client?.calls.length ?? 0).toBe(0);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
