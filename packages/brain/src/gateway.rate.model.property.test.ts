import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GATEWAY_PBT_OPTIONS, timeArb } from './gateway.arbitraries.js';
import { checkRate } from './gateway.rate.js';

const MINUTE_MS = 60_000;

/** Independent sliding-window model: count accepted τ with t − w < τ ≤ t. */
function modelAccepts(accepted: readonly number[], t: number, limit: number, windowMs: number): boolean {
  let count = 0;
  for (const tau of accepted) {
    if (t - windowMs < tau && tau <= t) count += 1;
  }
  return count < limit;
}

const limitArb = fc.integer({ min: 1, max: 60 });
const windowMsArb = fc.integer({ min: 1, max: 1440 }).map((m) => m * MINUTE_MS);

/** Gaps between receive times, biased toward 0 and the window edges. */
function gapArb(windowMs: number): fc.Arbitrary<number> {
  return fc.oneof(
    fc.constantFrom(0, 1, windowMs - 1, windowMs, windowMs + 1),
    fc.integer({ min: 0, max: Math.max(1, Math.floor(windowMs / 10)) }),
    fc.integer({ min: 0, max: 2 * windowMs }),
  );
}

describe('gateway.rate sliding-window model', () => {
  // Feature: necromancer-sms-gateway, Property 11: Rate_Limiter matches the sliding-window model
  it('Req 5.1, 5.2: checkRate matches the sliding-window model step by step', () => {
    const scenario = fc
      .tuple(limitArb, windowMsArb, timeArb)
      .chain(([limit, windowMs, start]) =>
        fc
          .array(gapArb(windowMs), { minLength: 1, maxLength: 150 })
          .map((gaps) => ({ limit, windowMs, start, gaps })),
      );

    fc.assert(
      fc.property(scenario, ({ limit, windowMs, start, gaps }) => {
        const modelRecord: number[] = [];
        let record: readonly number[] = [];
        let t = start;
        for (const gap of gaps) {
          t += gap;
          const expected = modelAccepts(modelRecord, t, limit, windowMs);
          const before = record;
          const { accepted } = checkRate(record, t, limit, windowMs);
          expect(accepted).toBe(expected);
          if (accepted) {
            modelRecord.push(t);
            record = [...record, t];
          } else {
            // Rejection leaves the stored records unchanged (Req 5.2).
            expect(record).toBe(before);
          }
          expect(record).toEqual(modelRecord);
        }
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });

  // Feature: necromancer-sms-gateway, Property 11: Rate_Limiter matches the sliding-window model
  it('Req 5.1, 5.2: checkRate matches the model for any stored list and time', () => {
    const scenario = fc
      .tuple(limitArb, windowMsArb, timeArb)
      .chain(([limit, windowMs, t]) =>
        fc
          .array(
            fc.oneof(
              fc.constantFrom(t, t - windowMs, t - windowMs + 1, t + 1),
              fc.integer({ min: t - 2 * windowMs, max: t + windowMs }),
            ),
            { maxLength: 80 },
          )
          .map((times) => ({ limit, windowMs, t, times })),
      );

    fc.assert(
      fc.property(scenario, ({ limit, windowMs, t, times }) => {
        const snapshot = [...times];
        const { accepted } = checkRate(times, t, limit, windowMs);
        expect(accepted).toBe(modelAccepts(times, t, limit, windowMs));
        expect(times).toEqual(snapshot);
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
