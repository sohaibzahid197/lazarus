import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { printableReminderText, REMINDER_PBT_OPTIONS } from './reminder.arbitraries.js';
import { parseReminder } from './reminder.parse.js';
import type { DayPeriod, ParseResult } from './reminder.types.js';

const PERIOD_WORDS: Readonly<Record<DayPeriod, readonly string[]>> = {
  morning: ['morning', 'subah', 'صبح'],
  evening: ['evening', 'shaam', 'شام'],
  night: ['night', 'raat', 'رات'],
};
const FILLERS: readonly string[] = ['at', 'ko', 'baje', 'کو', 'بجے'];

/** Bare-hour range after each Day_Period and the hours added (Requirement 2.6). */
const RANGE: Readonly<Record<DayPeriod, { min: number; max: number; add: number }>> = {
  morning: { min: 1, max: 12, add: 0 },
  evening: { min: 1, max: 11, add: 12 },
  night: { min: 6, max: 11, add: 12 },
};

const ARABIC_INDIC_ZERO = 0x06f0;

/** `n` in base 10, each digit ASCII or Extended Arabic-Indic. */
function digitsOf(n: number, width: number): fc.Arbitrary<string> {
  const digits = Array.from(String(n).padStart(width, '0'));
  return fc
    .tuple(
      ...digits.map((d) =>
        fc.constantFrom(d, String.fromCharCode(ARABIC_INDIC_ZERO + Number(d))),
      ),
    )
    .map((parts) => parts.join(''));
}

interface MinutePart {
  readonly sep: ':' | '.';
  readonly minute: number;
  readonly spelled: string;
}

const minutePart: fc.Arbitrary<MinutePart> = fc
  .record({ sep: fc.constantFrom<':' | '.'>(':', '.'), minute: fc.integer({ min: 0, max: 59 }) })
  .chain(({ sep, minute }) =>
    digitsOf(minute, 2).map((spelled): MinutePart => ({ sep, minute, spelled })),
  );

const periodCase = fc
  .record({
    period: fc.constantFrom<DayPeriod>('morning', 'evening', 'night'),
    wordIndex: fc.integer({ min: 0, max: 2 }),
    upper: fc.boolean(),
    filler: fc.option(fc.constantFrom(...FILLERS), { nil: null }),
    hour: fc.integer({ min: 0, max: 30 }),
    minute: fc.option(minutePart, { nil: null }),
    text: printableReminderText,
  })
  .chain((c) => digitsOf(c.hour, 1).map((hourSpelled) => ({ ...c, hourSpelled })));

/** Expected result of Requirements 2.5, 2.6, 2.7 and 2.12 for one generated case. */
function expected(
  period: DayPeriod,
  hour: number,
  minute: MinutePart | null,
  text: string,
): ParseResult {
  const mm = minute?.minute ?? 0;
  // `0:MM` and `13:MM`–`23:MM` are 24-hour clocks that drop the period (2.7).
  if (minute?.sep === ':' && (hour === 0 || (hour >= 13 && hour <= 23))) {
    return { ok: true, expr: { kind: 'clock', day: null, period: null, hour, minute: mm }, text };
  }
  const range = RANGE[period];
  if (hour < range.min || hour > range.max) return { ok: false, error: 'no-time' };
  return {
    ok: true,
    expr: { kind: 'clock', day: null, period, hour: hour + range.add, minute: mm },
    text,
  };
}

const noPeriodCase = fc.record({
  filler: fc.option(fc.constantFrom(...FILLERS), { nil: null }),
  hourSpelled: fc.integer({ min: 1, max: 12 }).chain((h) => digitsOf(h, 1)),
  minute: fc.option(
    fc.integer({ min: 0, max: 59 }).chain((m) => digitsOf(m, 2)),
    { nil: null },
  ),
  text: printableReminderText,
});

describe('Time_Parser Day_Period bare hours', () => {
  // Feature: sms-reminders, Property 7: Bare hours follow the Day_Period ranges
  it('2.6 bare hours follow the Day_Period ranges and other hours give no-time', () => {
    fc.assert(
      fc.property(periodCase, noPeriodCase, (c, n) => {
        const word = PERIOD_WORDS[c.period][c.wordIndex] ?? c.period;
        const head = [
          c.upper ? word.toUpperCase() : word,
          ...(c.filler === null ? [] : [c.filler]),
          c.hourSpelled + (c.minute === null ? '' : c.minute.sep + c.minute.spelled),
        ].join(' ');
        expect(parseReminder(`${head} ${c.text}`)).toEqual(
          expected(c.period, c.hour, c.minute, c.text),
        );

        // A bare hour with no Day_Period and no am/pm is no-time (2.12).
        const bare = [
          ...(n.filler === null ? [] : [n.filler]),
          n.hourSpelled + (n.minute === null ? '' : '.' + n.minute),
        ].join(' ');
        expect(parseReminder(`${bare} ${n.text}`)).toEqual({ ok: false, error: 'no-time' });
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
