import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  printableReminderText,
  REMINDER_PBT_OPTIONS,
  surfaceVariant,
  timeExpression,
} from './reminder.arbitraries.js';
import { parseReminder } from './reminder.parse.js';
import { printTimeExpression } from './reminder.print.js';
import type { TimeExpression } from './reminder.types.js';

const FILLERS: readonly string[] = ['at', 'ko', 'baje', 'کو', 'بجے'];
const WS_UNITS: readonly string[] = [' ', '\t', '\n'];

/** A run of 1 to 4 spaces, tabs and newlines (Requirement 2.2). */
const wsRun = fc.string({ unit: fc.constantFrom(...WS_UNITS), minLength: 1, maxLength: 4 });

/**
 * Token gaps where Requirement 2.11 allows one Filler_Word: gap i is before
 * token i, gap n is right after the expression. A Relative_Duration takes a
 * Filler_Word only before or after it (design grammar `F? relative F?`); the
 * other forms also take one between each pair of parts.
 */
function fillerGaps(expr: TimeExpression, tokenCount: number): readonly number[] {
  if (expr.kind === 'relative') return [0, tokenCount];
  return Array.from({ length: tokenCount + 1 }, (_, i) => i);
}

const surfaceCase = timeExpression.chain((expr) => {
  const tokens = printTimeExpression(expr).split(' ');
  return fc
    .record({
      filler: fc.option(
        fc.record({
          word: fc.constantFrom(...FILLERS),
          gap: fc.constantFrom(...fillerGaps(expr, tokens.length)),
        }),
        { nil: null },
      ),
      lead: fc.option(wsRun, { nil: '' }),
      sep: wsRun,
      text: printableReminderText,
    })
    .chain((c) => {
      const withFiller =
        c.filler === null
          ? tokens
          : [...tokens.slice(0, c.filler.gap), c.filler.word, ...tokens.slice(c.filler.gap)];
      return surfaceVariant(withFiller.join(' ')).map((variant) => ({
        expr,
        plain: tokens.join(' '),
        variant,
        ...c,
      }));
    });
});

describe('Time_Parser surface form independence', () => {
  // Feature: sms-reminders, Property 6: Surface form does not change the parse
  it('2.1 letter case, digit script, whitespace runs and one Filler_Word do not change the parse', () => {
    fc.assert(
      fc.property(surfaceCase, (c) => {
        const plain = parseReminder(`${c.plain} ${c.text}`);
        expect(plain).toEqual({ ok: true, expr: c.expr, text: c.text });
        expect(parseReminder(`${c.lead}${c.variant}${c.sep}${c.text}`)).toEqual(plain);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
