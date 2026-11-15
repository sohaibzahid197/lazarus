// Sanity checks for the snapshot arbitraries: generated values meet their contract.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REMINDER_TEXT_MAX } from '@lazarus/brain';
import { parseSnapshot, type SnapshotError } from '../../server/snapshot.parse';
import { SIMULATOR_NUMBER } from '../../server/simulatorNumber';
import { CRYPT_PBT_OPTIONS } from '../pbt';
import { snapshotAtArb, snapshotViolationAtArb } from './snapshot';

describe('snapshot arbitraries', () => {
  it('snapshotArb gives snapshots that parse at their Server_Time, also after JSON', () => {
    fc.assert(
      fc.property(snapshotAtArb, ({ serverTime, snapshot }) => {
        expect(parseSnapshot(snapshot, serverTime, SIMULATOR_NUMBER).ok).toBe(true);
        const json: unknown = JSON.parse(JSON.stringify(snapshot));
        expect(parseSnapshot(json, serverTime, SIMULATOR_NUMBER).ok).toBe(true);
        for (const r of snapshot.reminders) expect(r.text.length).toBeLessThanOrEqual(REMINDER_TEXT_MAX);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });

  it('snapshotViolationArb gives snapshots rejected with the named rule, also after JSON', () => {
    fc.assert(
      fc.property(snapshotViolationAtArb, ({ serverTime, violation }) => {
        const json: unknown = JSON.parse(JSON.stringify(violation.snapshot));
        for (const value of [violation.snapshot, json]) {
          expect(parseSnapshot(value, serverTime, SIMULATOR_NUMBER)).toEqual({ ok: false, error: violation.rule });
        }
      }),
      { ...CRYPT_PBT_OPTIONS, numRuns: 500 },
    );
  });

  it('covers past-due Reminders, counters for another day, every rule and the 120-time cap', () => {
    const valid = fc.sample(snapshotAtArb, { numRuns: 300, seed: 7 });
    expect(valid.some(({ serverTime, snapshot }) => snapshot.reminders.some((r) => r.dueAt < serverTime))).toBe(true);
    expect(valid.some(({ snapshot }) => snapshot.reminders.length === 5)).toBe(true);
    expect(valid.some(({ snapshot }) => snapshot.receiveTimes.length >= 100)).toBe(true);
    const days = new Set(valid.map(({ snapshot }) => snapshot.counters.dayKey));
    expect(days.size).toBeGreaterThan(1);

    const rules = new Set<SnapshotError>(
      fc.sample(snapshotViolationAtArb, { numRuns: 2_000, seed: 7 }).map(({ violation }) => violation.rule),
    );
    const all: readonly SnapshotError[] = [
      'not-object', 'unknown-field', 'missing-field', 'wrong-type', 'too-many-times', 'times-order',
      'too-many-reminders', 'bad-reminder-id', 'bad-slot', 'duplicate-slot', 'duplicate-id', 'bad-text',
      'due-too-far', 'created-after-due', 'time-in-future', 'bad-language', 'bad-count', 'bad-day-key',
    ];
    for (const rule of all) expect(rules.has(rule)).toBe(true);
  });
});
