// Feature: sms-reminders, Property 10: Printed and original expressions resolve the same
// **Validates: Requirements 4.3**
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseReminder } from './reminder.parse.js';
import { printTimeExpression } from './reminder.print.js';
import { resolveDueTime } from './reminder.resolve.js';
import {
  REMINDER_PBT_OPTIONS,
  printableReminderText,
  receiveTime,
  timeExpression,
} from './reminder.arbitraries.js';

describe('Property 10: Printed and original expressions resolve the same', () => {
  it('4.3: resolveDueTime of the parsed printed expression equals resolveDueTime of the original', () => {
    fc.assert(
      fc.property(timeExpression, printableReminderText, receiveTime, (expr, text, t) => {
        const parsed = parseReminder(`${printTimeExpression(expr)} ${text}`);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        // Same Due_Time to the millisecond, or the same Parse_Error.
        expect(resolveDueTime(parsed.expr, t)).toStrictEqual(resolveDueTime(expr, t));
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
