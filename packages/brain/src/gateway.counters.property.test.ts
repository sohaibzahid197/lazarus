// Feature: necromancer-sms-gateway, Property 26: Day counters match a naive count
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GATEWAY_PBT_OPTIONS } from './gateway.arbitraries.js';
import { localDayKey, recordFinal } from './gateway.counters.js';
import { OUTCOMES } from './gateway.types.js';
import type { DayCounters, Outcome } from './gateway.types.js';

const DAY_MS = 86_400_000;
const BASE = Date.UTC(2024, 0, 1);

interface Entry {
  readonly time: number;
  readonly outcome: Outcome;
  readonly partsSent: number;
}

const entryArb: fc.Arbitrary<Entry> = fc.record({
  // Spread over about 5 days so sequences cross several local midnights.
  time: fc.integer({ min: BASE, max: BASE + 5 * DAY_MS }),
  outcome: fc.constantFrom(...OUTCOMES),
  partsSent: fc.integer({ min: 0, max: 4 }),
});

// Offsets east of UTC from UTC−12:00 to UTC+14:00, including half-hour zones.
const tzArb = fc.integer({ min: -720, max: 840 });

// Stale counters from a day before every entry, with non-zero values to show the reset.
const staleArb: fc.Arbitrary<DayCounters> = fc.record({
  dayKey: fc.constant('2023-12-25'),
  received: fc.nat(50),
  repliesSent: fc.nat(50),
  replied: fc.nat(50),
  partsSent: fc.nat(200),
  ignored: fc.nat(50),
  handed: fc.nat(200),
});

describe('day counters (Property 26)', () => {
  /** **Validates: Requirements 13.12, 5.13** */
  it('Req 13.12, 5.13: folding recordFinal gives the last day a naive count of that day', () => {
    fc.assert(
      fc.property(
        fc.array(entryArb, { minLength: 1, maxLength: 60 }),
        tzArb,
        staleArb,
        (raw, tz, stale) => {
          const entries = [...raw].sort((a, b) => a.time - b.time);
          const final = entries.reduce(
            (c, e) => recordFinal(c, localDayKey(e.time, tz), e.outcome, e.partsSent),
            stale,
          );

          const lastDay = localDayKey(entries[entries.length - 1]!.time, tz);
          const today = entries.filter((e) => localDayKey(e.time, tz) === lastDay);
          const count = (p: (e: Entry) => boolean): number => today.filter(p).length;

          expect(final).toEqual({
            dayKey: lastDay,
            received: today.length,
            repliesSent: count((e) => e.outcome === 'replied' || e.outcome === 'started'),
            replied: count((e) => e.outcome === 'replied'),
            partsSent: today.reduce((s, e) => s + e.partsSent, 0),
            ignored: count((e) => e.outcome.startsWith('ignored-')),
            handed: 0,
          });
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
