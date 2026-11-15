// Property test for 12-hour Clock_Times in the Time_Parser.
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseReminder } from './reminder.parse.js';
import { REMINDER_PBT_OPTIONS, printableReminderText } from './reminder.arbitraries.js';

/** Maps an ASCII digit to its Extended Arabic-Indic form (U+06F0 to U+06F9). */
const toArabicIndic = (digit: string): string =>
  String.fromCodePoint(0x06f0 + Number(digit));

/** Writes each digit of `plain` in ASCII or Extended Arabic-Indic, chosen per digit. */
const spellDigits = (plain: string): fc.Arbitrary<string> =>
  fc
    .tuple(...Array.from(plain).map((d) => fc.constantFrom(d, toArabicIndic(d))))
    .map((parts) => parts.join(''));

/** `am` or `pm` in any letter case. */
const meridiemSpelling = (word: 'am' | 'pm'): fc.Arbitrary<string> =>
  fc
    .tuple(...Array.from(word).map((c) => fc.constantFrom(c, c.toUpperCase())))
    .map((parts) => parts.join(''));

const clock12Case = fc
  .record({
    hour: fc.integer({ min: 1, max: 12 }),
    minute: fc.option(fc.integer({ min: 0, max: 59 }), { nil: null }),
    separator: fc.constantFrom(':', '.'),
    pm: fc.boolean(),
    gap: fc.constantFrom('', ' '),
    text: printableReminderText,
  })
  .chain((c) =>
    fc.record({
      c: fc.constant(c),
      hourText: spellDigits(String(c.hour)),
      minuteText:
        c.minute === null
          ? fc.constant('')
          : spellDigits(String(c.minute).padStart(2, '0')).map((m) => c.separator + m),
      meridiem: meridiemSpelling(c.pm ? 'pm' : 'am'),
    }),
  );

describe('parseReminder: 12-hour Clock_Times', () => {
  // Feature: sms-reminders, Property 8: 12-hour clocks map to the right 24-hour time
  // **Validates: Requirements 2.3**
  it('2.3 maps h[:MM|.MM] am/pm to hour h % 12 (+12 for pm) with the given minutes', () => {
    fc.assert(
      fc.property(clock12Case, ({ c, hourText, minuteText, meridiem }) => {
        const input = `${hourText}${minuteText}${c.gap}${meridiem} ${c.text}`;
        expect(parseReminder(input)).toEqual({
          ok: true,
          expr: {
            kind: 'clock',
            day: null,
            period: null,
            hour: (c.hour % 12) + (c.pm ? 12 : 0),
            minute: c.minute ?? 0,
          },
          text: c.text,
        });
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
