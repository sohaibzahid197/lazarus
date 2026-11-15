// Feature: sms-reminders, Property 35: Delivery Activity_Entries never reveal the number or the text
// **Validates: Requirements 13.1, 13.4**
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildDeliveryEntry, buildProcessingFailedEntry } from './reminder.delivery.js';
import { reconcileOnLoad } from './reminder.store.js';
import { maskNumber } from './gateway.number.js';
import { DELIVERY_OUTCOMES, REMINDER_TEXT_MAX, type Reminder } from './reminder.types.js';
import type { ActivityEntry, CanonicalNumber } from './gateway.types.js';
import { REMINDER_PBT_OPTIONS, receiveTime, reminder } from './reminder.arbitraries.js';
import { gatewayState } from './gateway.arbitraries.js';

const MIN_RUN = 4;

/** Every run of 4 or more consecutive digits of the number (runs of 4 cover longer ones). */
function digitRuns(number: CanonicalNumber): string[] {
  const digits = number.slice(1);
  const runs: string[] = [];
  for (let i = 0; i + MIN_RUN <= digits.length; i++) runs.push(digits.slice(i, i + MIN_RUN));
  return runs;
}

/** The fields other than the receive time, as strings. */
function nonTimeFields(e: ActivityEntry): string[] {
  return [e.who, e.command, e.outcome];
}

function expectPrivate(e: ActivityEntry, r: Reminder): void {
  const fields = nonTimeFields(e);
  for (const run of digitRuns(r.number)) {
    for (const field of fields) expect(field).not.toContain(run);
  }
  if (Array.from(r.text).length >= MIN_RUN) {
    for (const field of fields) expect(field).not.toContain(r.text);
  }
}

/** A distinctive marker the entry must never echo. */
const marker = fc
  .string({ unit: fc.constantFrom(...'ABCDEFGHJKMNPQRSTUVWXYZ'.split('')), minLength: 3, maxLength: 6 })
  .map((s) => `ZQ${s}`);

/**
 * A Reminder whose text holds a marker and a 4+ digit run of its own number,
 * placed first so the length cut keeps them.
 */
const leakyReminder: fc.Arbitrary<Reminder> = reminder.chain((r) => {
  const digits = r.number.slice(1);
  return fc
    .record({
      m: marker,
      start: fc.integer({ min: 0, max: digits.length - MIN_RUN }),
      extra: fc.integer({ min: 0, max: digits.length }),
    })
    .map(({ m, start, extra }) => {
      const run = digits.slice(start, start + MIN_RUN + extra);
      const text = `${m} ${run} ${r.text}`.slice(0, REMINDER_TEXT_MAX).trim();
      return { ...r, text };
    });
});

describe('Property 35: Delivery Activity_Entries never reveal the number or the text', () => {
  it('13.1 13.4 buildDeliveryEntry holds maskNumber, REMIND and the outcome, and leaks no digits or text', () => {
    fc.assert(
      fc.property(
        fc.oneof(leakyReminder, reminder),
        fc.constantFrom(...DELIVERY_OUTCOMES),
        receiveTime,
        (r, outcome, recordedAt) => {
          const e = buildDeliveryEntry(r, outcome, recordedAt);
          expect(e).toEqual({
            receivedAt: recordedAt,
            who: maskNumber(r.number),
            command: 'REMIND',
            outcome,
          });
          expectPrivate(e, r);
        },
      ),
      REMINDER_PBT_OPTIONS,
    );
  });

  it('13.4 the processing-failed entry holds no digits at all outside the receive time', () => {
    fc.assert(
      fc.property(receiveTime, (at) => {
        const e = buildProcessingFailedEntry(at);
        expect(e.receivedAt).toBe(at);
        for (const field of nonTimeFields(e)) expect(field).not.toMatch(/[0-9]/);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });

  it('13.1 13.4 reconcileOnLoad entries for handed reminders are masked and leak no digits or text', () => {
    const cases = fc
      .array(leakyReminder, { minLength: 1, maxLength: 6 })
      .map((rs) => rs.map((r, i) => ({ ...r, id: `${r.id}-${String(i)}` as Reminder['id'] })))
      .chain((rs) =>
        fc.record({
          rs: fc.constant(rs),
          state: gatewayState(rs.map((r) => r.number), fc.constant({ status: 'ok' as const, reminders: rs })),
          now: receiveTime,
        }),
      );
    fc.assert(
      fc.property(cases, ({ rs, state, now }) => {
        const { entries } = reconcileOnLoad(state, now);
        const handed = rs.filter((r) => r.handedAt !== null && !state.stopList.has(r.number));
        expect(entries).toHaveLength(handed.length);
        entries.forEach((e, i) => {
          const r = handed[i];
          if (r === undefined) throw new Error('missing reminder');
          expect(e).toEqual({
            receivedAt: now,
            who: maskNumber(r.number),
            command: 'REMIND',
            outcome: 'reminder-failed',
          });
          expectPrivate(e, r);
        });
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
