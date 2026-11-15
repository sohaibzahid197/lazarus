// Feature: sms-reminders, Property 9: Time_Printer round trip
// **Validates: Requirements 4.2, 4.4, 2.4, 2.9, 2.10, 2.13**
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseReminder } from './reminder.parse.js';
import { isValidTimeExpression, printTimeExpression } from './reminder.print.js';
import {
  REMINDER_PBT_OPTIONS,
  printableReminderText,
  timeExpression,
} from './reminder.arbitraries.js';

describe('Property 9: Time_Printer round trip', () => {
  it('4.2: parseReminder(printTimeExpression(expr) + " " + text) gives back expr and text', () => {
    fc.assert(
      fc.property(timeExpression, printableReminderText, (expr, text) => {
        const result = parseReminder(`${printTimeExpression(expr)} ${text}`);
        // Field-for-field: same keys, same values, no extra fields. fc.record
        // builds null-prototype objects, so compare with a plain-object copy.
        expect(result).toStrictEqual({ ok: true, expr: { ...expr }, text });
        if (!result.ok) return;
        // Code-point-for-code-point on the Reminder_Text.
        expect(Array.from(result.text)).toStrictEqual(Array.from(text));
        // Requirement 4.4: the parsed value is a valid Time_Expression.
        expect(isValidTimeExpression(result.expr)).toBe(true);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
