import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REMINDER_PBT_OPTIONS, timeExpression } from './reminder.arbitraries.js';
import { printTimeExpression } from './reminder.print.js';

const MAX_PRINTED = 30;
const FILLER_WORDS: ReadonlySet<string> = new Set(['at', 'ko', 'baje', 'کو', 'بجے']);

/** 24-hour hour with no leading zero: 0 to 23. */
const HOUR_24 = '(?:[0-9]|1[0-9]|2[0-3])';
/** Bare hour after a Day_Period with no leading zero: 1 to 12. */
const HOUR_12 = '(?:[1-9]|1[0-2])';
const MINUTES = '[0-5][0-9]';
const DAY = '(?:(today|tomorrow) )?';

/** Day_Word, then Day_Period, then an optional bare-hour Clock_Time. */
const PERIOD_FORM = new RegExp(`^${DAY}(morning|evening|night)(?: (${HOUR_12}):(${MINUTES}))?$`);
/** Day_Word, then a 24-hour Clock_Time with no Day_Period. */
const CLOCK_FORM = new RegExp(`^${DAY}(${HOUR_24}):(${MINUTES})$`);
/** `in N unit` / `in N units`, N with no leading zeros. */
const RELATIVE_FORM = /^in ([1-9][0-9]*) (minute|hour|day)(s?)$/;

/** True when `text` matches the Requirement 4.1 grammar, including the plural rule. */
function matchesGrammar(text: string): boolean {
  const rel = RELATIVE_FORM.exec(text);
  if (rel !== null) return (rel[3] === 's') === (rel[1] !== '1');
  return PERIOD_FORM.test(text) || CLOCK_FORM.test(text);
}

describe('printTimeExpression totality and format (Property 11)', () => {
  // Feature: sms-reminders, Property 11: Printer output is short, total and stable
  /**
   * **Validates: Requirements 4.1, 4.5**
   */
  it('4.5 printTimeExpression never throws and returns the same non-empty text of at most 30 characters for equal expressions', () => {
    fc.assert(
      fc.property(timeExpression, (expr) => {
        let first = '';
        expect(() => {
          first = printTimeExpression(expr);
        }).not.toThrow();
        const again = printTimeExpression(expr);
        const fromClone = printTimeExpression(structuredClone(expr));
        expect(first.length).toBeGreaterThan(0);
        expect(first.length).toBeLessThanOrEqual(MAX_PRINTED);
        expect(again).toBe(first);
        expect(fromClone).toBe(first);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });

  // Feature: sms-reminders, Property 11: Printer output is short, total and stable
  /**
   * **Validates: Requirements 4.1, 4.5**
   */
  it('4.1 printTimeExpression returns one lowercase ASCII line in the Requirement 4.1 grammar with no Filler_Word', () => {
    fc.assert(
      fc.property(timeExpression, (expr) => {
        const text = printTimeExpression(expr);
        expect(text).toBe(text.toLowerCase());
        expect(text).toMatch(/^[\x20-\x7E]+$/);
        expect(text).not.toMatch(/^ | $| {2}/);
        expect(text.split(' ').filter((token) => FILLER_WORDS.has(token))).toEqual([]);
        expect(matchesGrammar(text)).toBe(true);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
