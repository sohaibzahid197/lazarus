// Feature: sms-reminders, Property 26: Load reconciliation removes stopped and handed reminders
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalNumber, gatewayState, timeArb } from './gateway.arbitraries.js';
import { applyChanges } from './gateway.pipeline.js';
import type { CanonicalNumber, GatewayState } from './gateway.types.js';
import { REMINDER_PBT_OPTIONS, reminderStore } from './reminder.arbitraries.js';
import { buildDeliveryEntry } from './reminder.delivery.js';
import { reconcileOnLoad } from './reminder.store.js';
import type { Reminder } from './reminder.types.js';

const remindersIn = (s: GatewayState): readonly Reminder[] =>
  s.reminders.status === 'ok' ? s.reminders.reminders : [];

/** A small shared pool so Stop_List numbers and Reminder numbers overlap often. */
const poolArb: fc.Arbitrary<CanonicalNumber[]> = fc.uniqueArray(canonicalNumber, {
  minLength: 1,
  maxLength: 3,
});

/** A readable state where some Reminders are explicitly marked handed (or cleared). */
const stateArb: fc.Arbitrary<GatewayState> = poolArb.chain((pool) =>
  gatewayState(pool, reminderStore(pool)).chain((s) => {
    const rs = remindersIn(s);
    return fc
      .array(fc.option(timeArb, { nil: null }), { minLength: rs.length, maxLength: rs.length })
      .map((marks): GatewayState => ({
        ...s,
        reminders: {
          status: 'ok',
          reminders: rs.map((r, i) => ({ ...r, handedAt: marks[i] ?? null })),
        },
      }));
  }),
);

describe('Property 26: Load reconciliation removes stopped and handed reminders', () => {
  it('8.8, 10.15 reconcileOnLoad removes stopped and handed reminders, logs one reminder-failed per handed non-stopped reminder and is idempotent', () => {
    // **Validates: Requirements 8.8, 10.15**
    fc.assert(
      fc.property(stateArb, timeArb, (state, now) => {
        const before = remindersIn(state);
        const stopped = (r: Reminder): boolean => state.stopList.has(r.number);
        const handedLive = before.filter((r) => r.handedAt !== null && !stopped(r));
        const kept = before.filter((r) => r.handedAt === null && !stopped(r));

        const { changes, entries } = reconcileOnLoad(state, now);

        // One reminder-remove-all per distinct stopped number with reminders, first-seen order.
        const stoppedNumbers = [...new Set(before.filter(stopped).map((r) => r.number))];
        expect(changes.filter((c) => c.type === 'reminder-remove-all')).toEqual(
          stoppedNumbers.map((number) => ({ type: 'reminder-remove-all', number })),
        );

        const after = applyChanges(state, changes);
        const left = remindersIn(after);
        expect(after.reminders.status).toBe('ok');
        expect(left.some(stopped)).toBe(false);
        expect(left.some((r) => r.handedAt !== null)).toBe(false);
        expect(left).toEqual(kept);

        expect(entries).toHaveLength(handedLive.length);
        expect(entries).toEqual(handedLive.map((r) => buildDeliveryEntry(r, 'reminder-failed', now)));
        for (const e of entries) expect(e.outcome).toBe('reminder-failed');

        const again = reconcileOnLoad(after, now);
        expect(again.changes).toEqual([]);
        expect(again.entries).toEqual([]);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });

  it('8.8, 10.15 an unreadable Reminder_Store yields no changes and no entries', () => {
    // **Validates: Requirements 8.8, 10.15**
    fc.assert(
      fc.property(
        poolArb.chain((pool) => gatewayState(pool, fc.constant({ status: 'unreadable' as const }))),
        timeArb,
        (state, now) => {
          expect(reconcileOnLoad(state, now)).toEqual({ changes: [], entries: [] });
        },
      ),
      REMINDER_PBT_OPTIONS,
    );
  });
});
