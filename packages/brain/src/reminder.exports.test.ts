// Entry-point exports test for the Reminder_Module.
// _Requirements: 11.12_
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as brain from './index.js';
import {
  ACTIVITY_OUTCOMES,
  activeFor,
  applyReminderChange,
  buildDeliveryEntry,
  buildProcessingFailedEntry,
  cappedReminderChanges,
  DAY_MS,
  decideDelivery,
  decodeReminders,
  DELIVERY_OUTCOMES,
  deliveryText,
  dueReminders,
  EMPTY_REMINDERS,
  encodeReminder,
  finalizeDelivery,
  findBySlot,
  formatReminderList,
  formatWhen,
  isValidTimeExpression,
  LATE_WINDOW_MS,
  lowestFreeSlot,
  nextDueAt,
  notAllowed,
  parseReminder,
  parseSlotArgument,
  PK_OFFSET_MS,
  pkDayStart,
  pkWallClock,
  printTimeExpression,
  reconcileOnLoad,
  REMINDER_HORIZON_MS,
  REMINDER_LIMIT,
  REMINDER_TEXT_MAX,
  REMINDER_TEXTS,
  reminderReply,
  reminderWriteFailed,
  resolveDueTime,
  stopChanges,
  toDigitValue,
} from './index.js';
import type {
  DeliveryOutcome,
  DeliveryStep,
  ParseResult,
  Reminder,
  ReminderState,
  ResolveResult,
  TimeExpression,
} from './index.js';

const reminderFunctions: Readonly<Record<string, unknown>> = {
  activeFor,
  applyReminderChange,
  buildDeliveryEntry,
  buildProcessingFailedEntry,
  cappedReminderChanges,
  decideDelivery,
  decodeReminders,
  deliveryText,
  dueReminders,
  encodeReminder,
  finalizeDelivery,
  findBySlot,
  formatReminderList,
  formatWhen,
  isValidTimeExpression,
  lowestFreeSlot,
  nextDueAt,
  notAllowed,
  parseReminder,
  parseSlotArgument,
  pkDayStart,
  pkWallClock,
  printTimeExpression,
  reconcileOnLoad,
  reminderReply,
  reminderWriteFailed,
  resolveDueTime,
  stopChanges,
  toDigitValue,
};

// Symbols exported only by reminder.arbitraries.ts (test-only module).
const ARBITRARY_ONLY = [
  'REMINDER_PBT_OPTIONS',
  'timeExpression',
  'reminderText',
  'hasPrintableFirstToken',
  'printableReminderText',
  'receiveTime',
  'reminder',
  'reminderStore',
  'surfaceVariant',
  'slotSpelling',
] as const;

describe('reminder entry exports (runtime)', () => {
  it.each(Object.entries(reminderFunctions))('exports %s as a function', (_name, value) => {
    expect(typeof value).toBe('function');
  });

  it('exports the reminder constants', () => {
    expect(DELIVERY_OUTCOMES).toHaveLength(6);
    for (const outcome of DELIVERY_OUTCOMES) {
      expect(ACTIVITY_OUTCOMES).toContain(outcome);
    }
    expect(EMPTY_REMINDERS).toEqual({ status: 'ok', reminders: [] });
    expect(REMINDER_LIMIT).toBe(5);
    expect(REMINDER_TEXT_MAX).toBe(140);
    expect(PK_OFFSET_MS).toBe(5 * 3_600_000);
    expect(DAY_MS).toBe(86_400_000);
    expect(REMINDER_HORIZON_MS).toBe(30 * DAY_MS);
    expect(LATE_WINDOW_MS).toBe(3_600_000);
    expect(Object.keys(REMINDER_TEXTS).length).toBeGreaterThan(0);
  });

  it('does not export the test-only arbitraries', () => {
    const exported: readonly string[] = Object.keys(brain);
    for (const name of ARBITRARY_ONLY) {
      expect(exported).not.toContain(name);
    }
  });
});

describe('reminder entry exports (types)', () => {
  it('derives DeliveryOutcome from DELIVERY_OUTCOMES', () => {
    expectTypeOf<DeliveryOutcome>().toEqualTypeOf<(typeof DELIVERY_OUTCOMES)[number]>();
    expectTypeOf<DeliveryOutcome>().toMatchTypeOf<(typeof ACTIVITY_OUTCOMES)[number]>();
  });

  it('exposes Reminder and TimeExpression', () => {
    expectTypeOf<Reminder>().toBeObject();
    expectTypeOf<Reminder['text']>().toBeString();
    expectTypeOf<Reminder['handedAt']>().toEqualTypeOf<number | null>();
    expectTypeOf<TimeExpression['kind']>().toEqualTypeOf<'clock' | 'period' | 'relative'>();
    expectTypeOf(printTimeExpression).parameter(0).toEqualTypeOf<TimeExpression>();
  });

  it('types the parser, resolver and store signatures', () => {
    expectTypeOf(parseReminder).returns.toEqualTypeOf<ParseResult>();
    expectTypeOf(resolveDueTime).returns.toEqualTypeOf<ResolveResult>();
    expectTypeOf(decideDelivery).returns.toEqualTypeOf<DeliveryStep>();
    expectTypeOf(EMPTY_REMINDERS).toEqualTypeOf<ReminderState>();
  });
});
