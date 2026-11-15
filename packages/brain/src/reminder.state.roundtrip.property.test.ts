// Feature: sms-reminders, Property 33: Reminder wire format round trip
// **Validates: Requirements 12.8**
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { canonicalNumber, dayCounters } from './gateway.arbitraries.js';
import { DEFAULT_SETTINGS, serializeSettings } from './gateway.settings.js';
import { decodeStoredState, serializeChanges } from './gateway.state.js';
import type { CanonicalNumber, StateChange } from './gateway.types.js';
import { REMINDER_PBT_OPTIONS, receiveTime, reminderStore } from './reminder.arbitraries.js';
import { decodeReminders, encodeReminder } from './reminder.state.js';
import type { Reminder } from './reminder.types.js';

const TODAY = '2024-01-02';
const POOL = ['+923001234567', '+923331112223'] as CanonicalNumber[];

/** True when `text` has no lone UTF-16 surrogate (the design's text domain). */
function isWellFormedUtf16(text: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
}

/** A full `loadState()` JSON carrying the encoded reminders. */
function loadStateJson(reminders: readonly Reminder[], counters: unknown): string {
  return JSON.stringify({
    stopList: [POOL[0]],
    allowlist: null,
    rate: [],
    slowDown: [],
    counters,
    settings: serializeSettings(DEFAULT_SETTINGS),
    paused: false,
    reminders: reminders.map(encodeReminder),
  });
}

/** Each reminder change paired with the exact JSON object `serializeChanges` must emit. */
function changesFor(
  reminders: readonly Reminder[],
  extraNumber: CanonicalNumber,
  at: number,
): { changes: StateChange[]; expected: Record<string, unknown>[] } {
  const changes: StateChange[] = [];
  const expected: Record<string, unknown>[] = [];
  for (const r of reminders) {
    changes.push({ type: 'reminder-add', reminder: r });
    expected.push({ type: 'reminder-add', reminder: { ...r } });
    changes.push({ type: 'reminder-remove', id: r.id });
    expected.push({ type: 'reminder-remove', id: r.id });
    changes.push({ type: 'reminder-handed', id: r.id, at });
    expected.push({ type: 'reminder-handed', id: r.id, at });
    changes.push({ type: 'reminder-remove-all', number: r.number });
    expected.push({ type: 'reminder-remove-all', number: r.number });
  }
  changes.push({ type: 'reminder-remove-all', number: extraNumber });
  expected.push({ type: 'reminder-remove-all', number: extraNumber });
  return { changes, expected };
}

describe('Property 33: Reminder wire format round trip', () => {
  it('12.8 encoded reminders decode back to the same store, alone and inside loadState, and reminder changes serialize with exactly their keys', () => {
    fc.assert(
      fc.property(
        reminderStore(POOL),
        dayCounters(1000),
        canonicalNumber,
        receiveTime,
        (store, counters, extraNumber, at) => {
          if (store.status !== 'ok') throw new Error('reminderStore must be readable');
          const reminders = store.reminders;
          // The design's text domain: no lone surrogates (they do not survive JSON.stringify unchanged).
          for (const r of reminders) expect(isWellFormedUtf16(r.text)).toBe(true);

          // Direct: encode, JSON round trip, decode.
          const wire: unknown = JSON.parse(JSON.stringify(reminders.map(encodeReminder)));
          expect(decodeReminders(wire)).toStrictEqual({ status: 'ok', reminders: [...reminders] });

          // Through the full loadState JSON.
          const decoded = decodeStoredState(loadStateJson(reminders, counters), TODAY);
          expect(decoded.status).toBe('ok');
          if (decoded.status !== 'ok') return;
          expect(decoded.state.reminders).toStrictEqual({ status: 'ok', reminders: [...reminders] });

          // serializeChanges: each reminder change parses to exactly its declared keys.
          const { changes, expected } = changesFor(reminders, extraNumber, at);
          expect(JSON.parse(serializeChanges(changes))).toStrictEqual(expected);
        },
      ),
      REMINDER_PBT_OPTIONS,
    );
  });
});
