import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ACTIVITY_LOG_MAX, trimActivityLog } from './gateway.activity.js';
import { GATEWAY_PBT_OPTIONS, timeArb } from './gateway.arbitraries.js';
import { OUTCOMES } from './gateway.types.js';
import { COMMANDS } from './router.types.js';
import type { ActivityEntry } from './gateway.types.js';

/** Receive times: a narrow range forces many ties, timeArb spreads them out. */
const receivedAtArb = fc.oneof(fc.integer({ min: 0, max: 20 }), timeArb);

const entryShapeArb = fc.record({
  receivedAt: receivedAtArb,
  command: fc.constantFrom<ActivityEntry['command']>(...COMMANDS, 'NONE'),
  outcome: fc.constantFrom(...OUTCOMES),
});

/** Each entry gets a unique `who` so the comparison identifies entries exactly. */
const entriesArb = fc
  .array(entryShapeArb, { maxLength: 400 })
  .map((shapes) => shapes.map((s, i): ActivityEntry => ({ ...s, who: `***${i}` })));

/** Naive model: keep everything, newest first, later-added first on ties, take 200. */
function modelLog(added: readonly ActivityEntry[]): ActivityEntry[] {
  return added
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => b.entry.receivedAt - a.entry.receivedAt || b.order - a.order)
    .slice(0, ACTIVITY_LOG_MAX)
    .map(({ entry }) => entry);
}

describe('gateway.activity trimming', () => {
  // Feature: necromancer-sms-gateway, Property 27: Activity_Log keeps the newest 200
  it('Req 14.3, 14.4: folding trimActivityLog keeps the newest 200, newest first', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        let log: ActivityEntry[] = [];
        entries.forEach((entry, i) => {
          log = trimActivityLog(log, entry);
          expect(log.length).toBeLessThanOrEqual(ACTIVITY_LOG_MAX);
          for (let k = 1; k < log.length; k += 1) {
            expect(log[k - 1]!.receivedAt).toBeGreaterThanOrEqual(log[k]!.receivedAt);
          }
          expect(log).toEqual(modelLog(entries.slice(0, i + 1)));
        });
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
