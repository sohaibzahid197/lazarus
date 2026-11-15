import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REMINDER_PBT_OPTIONS, timeExpression } from './reminder.arbitraries.js';
import { parseReminder } from './reminder.parse.js';
import { isValidTimeExpression, printTimeExpression } from './reminder.print.js';
import { REMINDER_TEXT_MAX, type ParseResult } from './reminder.types.js';

const PARSE_ERRORS: ReadonlySet<string> = new Set(['no-time', 'no-text', 'text-too-long']);

const WS_UNITS: readonly string[] = [' ', '\t', '\n', '\r', '\u00A0', '\u3000'];
const whitespaceOnly: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(...WS_UNITS),
  maxLength: 20,
});

/** A lone high or low surrogate code unit. */
const loneSurrogate: fc.Arbitrary<string> = fc
  .integer({ min: 0xd800, max: 0xdfff })
  .map((code) => String.fromCharCode(code));

/** Strings with lone surrogates mixed into ordinary text and whitespace. */
const withLoneSurrogates: fc.Arbitrary<string> = fc.string({
  unit: fc.oneof(loneSurrogate, fc.constantFrom(...WS_UNITS), fc.string({ maxLength: 1 })),
  minLength: 1,
  maxLength: 60,
});

/** Strings longer than 10,000 characters, built by repeating a short chunk. */
const veryLong: fc.Arbitrary<string> = fc
  .tuple(fc.string({ unit: 'binary', minLength: 1, maxLength: 20 }), fc.integer({ min: 0, max: 50 }))
  .map(([chunk, extra]) => chunk.repeat(Math.ceil(10_001 / chunk.length) + extra));

const separator: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n'),
  minLength: 1,
  maxLength: 3,
});

/** REMIND-like arguments: a valid printed Time_Expression followed by random text. */
const remindLike: fc.Arbitrary<string> = fc
  .tuple(
    timeExpression.map(printTimeExpression),
    separator,
    fc.oneof(
      fc.string({ unit: 'grapheme', minLength: 1, maxLength: 40 }),
      fc.string({ unit: 'binary', maxLength: 200 }),
      fc.string({ unit: 'binary', minLength: 141, maxLength: 300 }),
      whitespaceOnly,
    ),
  )
  .map(([expr, sep, text]) => `${expr}${sep}${text}`);

/** A REMIND-like prefix followed by more than 10,000 characters. */
const remindLikeLong: fc.Arbitrary<string> = fc
  .tuple(timeExpression.map(printTimeExpression), veryLong)
  .map(([expr, tail]) => `${expr} ${tail}`);

const anyArgument: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  whitespaceOnly,
  withLoneSurrogates,
  veryLong,
  fc.string({ unit: 'binary', maxLength: 200 }),
  remindLike,
  remindLike,
  remindLikeLong,
);

function expectWellFormed(result: ParseResult): void {
  if (result.ok) {
    expect(Object.keys(result).sort()).toEqual(['expr', 'ok', 'text']);
    expect(isValidTimeExpression(result.expr)).toBe(true);
    // UTF-16 code units (Requirement 2.15).
    const length = result.text.length;
    expect(length).toBeGreaterThanOrEqual(1);
    expect(length).toBeLessThanOrEqual(REMINDER_TEXT_MAX);
    expect(result.text).toBe(result.text.trim());
  } else {
    expect(Object.keys(result).sort()).toEqual(['error', 'ok']);
    expect(PARSE_ERRORS.has(result.error)).toBe(true);
  }
}

// Feature: sms-reminders, Property 4: Time_Parser never throws
describe('Property 4: Time_Parser never throws', () => {
  /**
   * **Validates: Requirements 2.16**
   */
  it('2.16 parseReminder returns a well-formed ParseResult for any string and never throws', () => {
    fc.assert(
      fc.property(anyArgument, (argument) => {
        let result: ParseResult | undefined;
        expect(() => {
          result = parseReminder(argument);
        }).not.toThrow();
        if (result === undefined) throw new Error('parseReminder returned undefined');
        expectWellFormed(result);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
