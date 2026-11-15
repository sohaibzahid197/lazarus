// Feature: crypt-ouija-simulator, Property 14: Invalid requests get a bare 400
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { invalidRequestArb } from '../test/arbitraries/request';
import { makeHandler, post } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { REAL_BRAIN, type BrainFns } from './brainFns';

/** Same time as the valid snapshot inside `invalidRequestArb`. */
const SERVER_TIME = 1_767_225_600_000;

/** Wraps every brain function with a counter, so the test sees any call. */
function countingBrain(): { brain: BrainFns; calls: () => number } {
  let calls = 0;
  const brain: BrainFns = {
    runGatewayPipeline: (...args) => {
      calls += 1;
      return REAL_BRAIN.runGatewayPipeline(...args);
    },
    applyChanges: (...args) => {
      calls += 1;
      return REAL_BRAIN.applyChanges(...args);
    },
    finalizeSend: (...args) => {
      calls += 1;
      return REAL_BRAIN.finalizeSend(...args);
    },
    decideDelivery: (...args) => {
      calls += 1;
      return REAL_BRAIN.decideDelivery(...args);
    },
    finalizeDelivery: (...args) => {
      calls += 1;
      return REAL_BRAIN.finalizeDelivery(...args);
    },
  };
  return { brain, calls: () => calls };
}

describe('Invalid requests', () => {
  /**
   * **Validates: Requirements 6.2, 7.7, 7.13**
   */
  it('Feature: crypt-ouija-simulator, Property 14: Invalid requests get a bare 400', async () => {
    await fc.assert(
      fc.asyncProperty(invalidRequestArb, async ({ raw, error }) => {
        const counter = countingBrain();
        const h = makeHandler({ now: SERVER_TIME, brain: counter.brain });

        const res = await post(h.handler, raw);

        expect(res.status).toBe(400);
        expect(res.json).toEqual({ error });
        expect(Object.keys(res.json as object)).toEqual(['error']);
        expect(res.headers.get('set-cookie')).toBeNull();
        expect(counter.calls()).toBe(0);
        expect(h.client?.calls.length ?? 0).toBe(0);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
