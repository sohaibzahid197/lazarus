// Sanity checks for the reminder generators: sampled values meet the
// constraints the property tests rely on.
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as brain from './index.js';
import {
  REMINDER_PBT_OPTIONS,
  hasPrintableFirstToken,
  printableReminderText,
  receiveTime,
  reminder,
  reminderStore,
  reminderText,
  slotSpelling,
  surfaceVariant,
  timeExpression,
} from './reminder.arbitraries.js';
import type { CanonicalNumber } from './gateway.types.js';

const SAMPLE = { numRuns: 300, seed: 42 } as const;
const digitValue = (s: string): number =>
  Number(Array.from(s, (c) => (c >= '\u06F0' ? String(c.charCodeAt(0) - 0x06f0) : c)).join(''));

describe('reminder arbitraries', () => {
  it('runs properties at least 100 times', () => {
    expect(REMINDER_PBT_OPTIONS.numRuns).toBeGreaterThanOrEqual(100);
  });

  it('time expressions are valid per Requirement 4.4', () => {
    const ranges = { morning: [1, 12], evening: [13, 23], night: [18, 23] } as const;
    for (const e of fc.sample(timeExpression, SAMPLE)) {
      if (e.kind === 'relative') {
        expect(e.amount).toBeGreaterThanOrEqual(1);
        expect(e.amount).toBeLessThanOrEqual(999_999);
      } else if (e.kind === 'clock') {
        expect(e.minute).toBeGreaterThanOrEqual(0);
        expect(e.minute).toBeLessThanOrEqual(59);
        const [lo, hi] = e.period === null ? [0, 23] : ranges[e.period];
        expect(e.hour).toBeGreaterThanOrEqual(lo);
        expect(e.hour).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('reminder texts are trimmed and 1 to 140 UTF-16 code units', () => {
    for (const t of fc.sample(reminderText, SAMPLE)) {
      expect(t).toBe(t.trim());
      expect(t.length).toBeGreaterThanOrEqual(1);
      expect(t.length).toBeLessThanOrEqual(140);
    }
  });

  it('printable texts pass the first-token filter', () => {
    for (const t of fc.sample(printableReminderText, SAMPLE)) expect(hasPrintableFirstToken(t)).toBe(true);
    for (const bad of ['AT home', 'kal x', 'بعد x', '8pm x', '۵ x', 'Minutes x', 'رات']) {
      expect(hasPrintableFirstToken(bad)).toBe(false);
    }
    expect(hasPrintableFirstToken('take medicine')).toBe(true);
  });

  it('receive times are integers in range', () => {
    for (const t of fc.sample(receiveTime, SAMPLE)) {
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(4_102_444_800_000);
    }
  });

  it('reminders have a Due_Time within 30 days of creation', () => {
    for (const r of fc.sample(reminder, SAMPLE)) {
      expect(r.id.startsWith('r:')).toBe(true);
      expect(r.dueAt - r.createdAt).toBeGreaterThan(0);
      expect(r.dueAt - r.createdAt).toBeLessThanOrEqual(2_592_000_000);
    }
  });

  it('stores hold at most 5 reminders per number, distinct slots and ids', () => {
    const pool = ['+923001234567' as CanonicalNumber];
    for (const s of fc.sample(reminderStore(pool), SAMPLE)) {
      expect(s.status).toBe('ok');
      if (s.status !== 'ok') continue;
      expect(new Set(s.reminders.map((r) => r.id)).size).toBe(s.reminders.length);
      const byNumber = new Map<string, number[]>();
      for (const r of s.reminders) byNumber.set(r.number, [...(byNumber.get(r.number) ?? []), r.slot]);
      for (const slots of byNumber.values()) {
        expect(slots.length).toBeLessThanOrEqual(5);
        expect(new Set(slots).size).toBe(slots.length);
      }
    }
  });

  it('surface variants keep non-letter, non-digit, non-space characters', () => {
    for (const v of fc.sample(surfaceVariant('tomorrow morning 9:05'), SAMPLE)) {
      expect(v.replace(/[ \t\n]+/g, ' ').toLowerCase().replace(/[\u06F0-\u06F9]/g, (c) =>
        String(c.charCodeAt(0) - 0x06f0),
      )).toBe('tomorrow morning 9:05');
    }
  });

  it('slot spellings are 1 to 3 digits with value n', () => {
    for (const n of [0, 2, 5, 42, 999]) {
      for (const s of fc.sample(slotSpelling(n), { numRuns: 50, seed: n })) {
        expect(s).toMatch(/^[0-9\u06F0-\u06F9]{1,3}$/);
        expect(digitValue(s)).toBe(n);
      }
    }
  });

  it('are not exported from index.ts', () => {
    expect(Object.keys(brain)).not.toContain('timeExpression');
    expect(Object.keys(brain)).not.toContain('REMINDER_PBT_OPTIONS');
  });
});
