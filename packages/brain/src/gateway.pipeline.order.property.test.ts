// Feature: necromancer-sms-gateway, Property 35: Inbound ordering
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GATEWAY_PBT_OPTIONS, timeArb } from './gateway.arbitraries.js';
import { orderInbound } from './gateway.pipeline.js';
import type { InboundMessage } from './gateway.types.js';

/** A small pool of receive times so that many messages tie on receivedAt. */
const receivedAtPool = fc.uniqueArray(timeArb, { minLength: 1, maxLength: 4 });

/** Inbound messages with unique seq, in arbitrary order, with many receivedAt ties. */
const inboundList: fc.Arbitrary<InboundMessage[]> = receivedAtPool.chain((times) =>
  fc
    .uniqueArray(
      fc.record({
        seq: fc.integer({ min: 0, max: 1_000_000 }),
        receivedAt: fc.constantFrom(...times),
        sender: fc.string({ maxLength: 15 }),
        body: fc.string({ maxLength: 40 }),
      }),
      { selector: (m) => m.seq, maxLength: 30 },
    )
    .map((items) => items.map((m) => ({ id: `row-${m.seq}`, ...m }))),
);

function isOrdered(list: readonly InboundMessage[]): boolean {
  return list.every((m, i) => {
    if (i === 0) return true;
    const prev = list[i - 1]!;
    return (
      prev.receivedAt < m.receivedAt || (prev.receivedAt === m.receivedAt && prev.seq < m.seq)
    );
  });
}

describe('Property 35: Inbound ordering', () => {
  it('orderInbound returns a sorted permutation by (receivedAt, seq) without mutating input (Req 1.7)', () => {
    /** **Validates: Requirements 1.7** */
    fc.assert(
      fc.property(inboundList, (messages) => {
        const snapshot = structuredClone(messages);
        const inputRefs = [...messages];

        const ordered = orderInbound(messages);

        // A new array; the input is unchanged in order and content.
        expect(ordered).not.toBe(messages);
        expect(messages).toEqual(snapshot);
        messages.forEach((m, i) => expect(m).toBe(inputRefs[i]));

        // Permutation: same length, every input message appears exactly once.
        expect(ordered).toHaveLength(messages.length);
        expect(new Set(ordered).size).toBe(ordered.length);
        for (const m of messages) expect(ordered).toContain(m);

        // Ascending by receivedAt, ties broken by ascending seq.
        expect(isOrdered(ordered)).toBe(true);

        // Idempotent.
        expect(orderInbound(ordered)).toEqual(ordered);
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
