// Feature: sms-reminders, Property 5: Time_Parser is deterministic
// **Validates: Requirements 2.17**
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseReminder } from './reminder.parse.js';
import { printTimeExpression } from './reminder.print.js';
import {
  REMINDER_PBT_OPTIONS,
  reminderText,
  surfaceVariant,
  timeExpression,
} from './reminder.arbitraries.js';

/** A printed valid Time_Expression (in any surface form) followed by a Reminder_Text. */
const timePrefixed: fc.Arbitrary<string> = fc
  .tuple(timeExpression.chain((expr) => surfaceVariant(printTimeExpression(expr))), reminderText)
  .map(([time, text]) => `${time} ${text}`);

/** Arguments that exercise every branch: ok, no-time, no-text and text-too-long. */
const argument: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: timePrefixed, weight: 3 },
  { arbitrary: timeExpression.map(printTimeExpression), weight: 1 },
  { arbitrary: fc.string({ maxLength: 200 }), weight: 1 },
  { arbitrary: fc.string({ unit: 'grapheme', maxLength: 200 }), weight: 1 },
);

describe('Property 5: Time_Parser is deterministic', () => {
  it('2.17: two calls of parseReminder with the same string return deeply equal results', () => {
    let okCount = 0;
    fc.assert(
      fc.property(argument, argument, (input, other) => {
        const first = parseReminder(input);
        // A call with a different input in between catches hidden state.
        parseReminder(other);
        const second = parseReminder(input);
        if (first.ok) okCount += 1;
        expect(second).toEqual(first);
      }),
      REMINDER_PBT_OPTIONS,
    );
    expect(okCount).toBeGreaterThan(0);
  });
});
