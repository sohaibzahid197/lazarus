// Feature: necromancer-sms-gateway, Property 22: Send finalization accounting
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GATEWAY_PBT_OPTIONS,
  canonicalNumber,
  dayKeyArb,
  languageArb,
  sendReport,
  timeArb,
} from './gateway.arbitraries.js';
import { finalizeSend } from './gateway.pipeline.js';
import type { DayCounters, GatewayDecision, Outcome, SendReport } from './gateway.types.js';

type Provisional = 'replied' | 'started' | 'rate-limited';

const PROVISIONAL: readonly Provisional[] = ['replied', 'started', 'rate-limited'];

const decisionArb = (partCount: number): fc.Arbitrary<GatewayDecision> =>
  fc.record({
    messageId: fc.string({ minLength: 1, maxLength: 8 }),
    receivedAt: timeArb,
    sender: canonicalNumber.map((number) => ({ kind: 'phone' as const, number })),
    command: fc.constant(null),
    language: languageArb,
    outcome: fc.constantFrom<Outcome>(...PROVISIONAL),
    parts: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
      minLength: partCount,
      maxLength: partCount,
    }),
    changes: fc.constant([]),
  });

const count = fc.integer({ min: 0, max: 5000 });

/** Counters for `today` or for another day; `handed` may be below the part count. */
const countersArb = (today: string): fc.Arbitrary<DayCounters> =>
  fc.record({
    dayKey: fc.oneof(fc.constant(today), dayKeyArb),
    received: count,
    repliesSent: count,
    replied: count,
    partsSent: count,
    ignored: count,
    handed: fc.oneof(fc.integer({ min: 0, max: 5 }), count),
  });

interface Case {
  readonly decision: GatewayDecision;
  readonly report: SendReport | null;
  readonly counters: DayCounters;
  readonly today: string;
}

const withParts: fc.Arbitrary<Case> = fc
  .tuple(fc.integer({ min: 1, max: 4 }), dayKeyArb)
  .chain(([n, today]) =>
    fc.record({
      decision: decisionArb(n),
      report: sendReport(n),
      counters: countersArb(today),
      today: fc.constant(today),
    }),
  );

const noParts: fc.Arbitrary<Case> = dayKeyArb.chain((today) =>
  fc.record({
    decision: decisionArb(0),
    report: fc.constant(null),
    counters: countersArb(today),
    today: fc.constant(today),
  }),
);

const caseArb: fc.Arbitrary<Case> = fc.oneof(
  { arbitrary: withParts, weight: 5 },
  { arbitrary: noParts, weight: 1 },
);

/** Independent model of the design "Send finalization" table. */
function model(c: Case): { outcome: Outcome; partsSent: number; counters: DayCounters } {
  const n = c.decision.parts.length;
  const base: DayCounters =
    c.counters.dayKey === c.today
      ? c.counters
      : {
          dayKey: c.today,
          received: 0,
          repliesSent: 0,
          replied: 0,
          partsSent: 0,
          ignored: 0,
          handed: 0,
        };

  let outcome: Outcome;
  let partsSent: number;
  let handed = base.handed;
  const r = c.report;
  if (r === null) {
    outcome = c.decision.outcome;
    partsSent = 0;
  } else if (r.status === 'refused-stopped' || r.status === 'cancelled') {
    outcome = 'ignored-stopped';
    partsSent = 0;
    handed = Math.max(0, handed - n);
  } else {
    const sent = r.results.filter((x) => x === 'sent').length;
    if (r.results.length === n && sent === n) {
      outcome = c.decision.outcome;
      partsSent = n;
    } else {
      outcome = 'send-failed';
      partsSent = sent;
    }
  }

  const counters: DayCounters = {
    dayKey: c.today,
    received: base.received + 1,
    repliesSent: base.repliesSent + (outcome === 'replied' || outcome === 'started' ? 1 : 0),
    replied: base.replied + (outcome === 'replied' ? 1 : 0),
    partsSent: base.partsSent + partsSent,
    ignored: base.ignored + (outcome === 'ignored-stopped' ? 1 : 0),
    handed,
  };
  return { outcome, partsSent, counters };
}

describe('Property 22: Send finalization accounting', () => {
  it('matches the finalization table (Requirements 3.8, 3.9, 8.4, 8.5, 8.10)', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const result = finalizeSend(c.decision, c.report, c.counters, c.today);
        const expected = model(c);
        expect(result.outcome).toBe(expected.outcome);
        expect(result.partsSent).toBe(expected.partsSent);
        expect(result.changes).toEqual([{ type: 'counters', counters: expected.counters }]);
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
