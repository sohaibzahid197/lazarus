// Unit tests for the List_Formatter.
// _Requirements: 6.2, 6.3_
import { describe, it, expect } from 'vitest';
import type { CanonicalNumber } from './gateway.types.js';
import { formatWhen } from './reminder.clock.js';
import { formatReminderList } from './reminder.list.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import type { Reminder, ReminderId, ReminderSlot } from './reminder.types.js';
import { REMINDER_TEXT_MAX } from './reminder.types.js';
import type { Language } from './router.types.js';
import { splitSms } from './sms.js';

const NUM = '+923001234567' as CanonicalNumber;
// 2025-01-15T05:00:00.000Z, which is 15 Jan 10:00 Pakistan_Time.
const JAN_15_10AM = 1_736_917_200_000;
// 2025-01-15T00:00:00.000Z, receive time of the REMIND messages.
const CREATED = 1_736_899_200_000;
const HOUR = 3_600_000;

function rem(slot: ReminderSlot, dueAt: number, text: string, language: Language = 'en'): Reminder {
  return {
    id: `r:m${slot}` as ReminderId,
    number: NUM,
    slot,
    dueAt,
    text,
    language,
    createdAt: CREATED,
    handedAt: null,
  };
}

/** Expected reply built by hand with a shared preview of `length` code points. */
function expectedReply(sorted: readonly Reminder[], language: Language, length: number): string {
  const entries = sorted.map((r) => {
    const head = `${r.slot}) ${formatWhen(r.dueAt, language)}`;
    const shown = Array.from(r.text).slice(0, length).join('');
    return shown === '' ? head : `${head} ${shown}`;
  });
  return REMINDER_TEXTS[language].listLead + entries.join('; ');
}

describe('formatReminderList', () => {
  it('shows short Reminder_Texts whole, in ascending Due_Time order', () => {
    const reminders = [
      rem(1, JAN_15_10AM + 2 * HOUR, 'call Ali'),
      rem(2, JAN_15_10AM, 'take medicine'),
    ];
    expect(formatReminderList(reminders, 'en')).toBe(
      'Your reminders: 2) 15 Jan 10:00 take medicine; 1) 15 Jan 12:00 call Ali',
    );
  });

  it('cuts a Reminder_Text longer than 20 code points to its first 20 when the list fits', () => {
    const reminders = [rem(1, JAN_15_10AM, 'drink water and walk for 10 minutes')];
    expect(formatReminderList(reminders, 'en')).toBe(
      'Your reminders: 1) 15 Jan 10:00 drink water and walk',
    );
  });

  it('orders Active_Reminders with equal Due_Times by ascending slot', () => {
    const reminders = [
      rem(3, JAN_15_10AM, 'three'),
      rem(1, JAN_15_10AM, 'one'),
      rem(2, JAN_15_10AM, 'two'),
    ];
    expect(formatReminderList(reminders, 'en')).toBe(
      'Your reminders: 1) 15 Jan 10:00 one; 2) 15 Jan 10:00 two; 3) 15 Jan 10:00 three',
    );
  });

  it('shrinks the shared preview for 5 reminders of 140 UTF-16 code units of UCS-2 text', () => {
    const text = 'ب'.repeat(REMINDER_TEXT_MAX);
    expect(text.length).toBe(REMINDER_TEXT_MAX);
    const slots: readonly ReminderSlot[] = [1, 2, 3, 4, 5];
    const reminders = slots.map((s) => rem(s, JAN_15_10AM + s * HOUR, text, 'ur'));

    const reply = formatReminderList(reminders, 'ur');

    // The full 20-code-point list does not fit 3 parts.
    expect(splitSms(expectedReply(reminders, 'ur', 20)).length).toBeGreaterThan(3);
    // The reply fits 3 parts and uses the largest shared length that fits.
    expect(splitSms(reply).length).toBeLessThanOrEqual(3);
    const lengths = Array.from({ length: 20 }, (_, i) => 19 - i);
    const used = lengths.find((n) => expectedReply(reminders, 'ur', n) === reply);
    expect(used).toBeDefined();
    expect(used).toBeLessThan(20);
    expect(used).toBeGreaterThan(0);
    expect(splitSms(expectedReply(reminders, 'ur', (used ?? 0) + 1)).length).toBeGreaterThan(3);
    for (const r of reminders) {
      expect(reply).toContain(`${r.slot}) ${formatWhen(r.dueAt, 'ur')}`);
    }
  });

  it('at preview length 0 shows no preview but keeps every slot and Due_Time', () => {
    const slots: readonly ReminderSlot[] = [1, 2, 3, 4, 5];
    const reminders = slots.map((s) => rem(s, JAN_15_10AM + s * HOUR, `task ${s}`));
    // A splitter that reports 4 parts for every reply forces the length-0 fallback.
    const split = (): string[] => ['a', 'b', 'c', 'd'];

    const reply = formatReminderList(reminders, 'en', split);

    expect(reply).toBe(
      'Your reminders: 1) 15 Jan 11:00; 2) 15 Jan 12:00; 3) 15 Jan 13:00; 4) 15 Jan 14:00; 5) 15 Jan 15:00',
    );
    expect(reply).not.toContain(' t');
  });
});
