// Property test: every Time_Help example routes, parses and resolves.
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { routeCommand } from './router.js';
import { parseReminder } from './reminder.parse.js';
import { resolveDueTime } from './reminder.resolve.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import { REMINDER_TEXT_MAX } from './reminder.types.js';
import type { Language } from './router.types.js';
import { REMINDER_PBT_OPTIONS, receiveTime } from './reminder.arbitraries.js';

const LANGUAGES = Object.keys(REMINDER_TEXTS) as Language[];

/** Every example REMIND message from the Time_Help_Text data of every Language. */
const EXAMPLES = LANGUAGES.flatMap((language) => REMINDER_TEXTS[language].timeHelpExamples);

/** Routes, parses and resolves one example at receive time `t`. */
function checkExample(example: string, t: number): void {
  const routed = routeCommand(example);
  expect(routed.command).toBe('REMIND');
  expect(routed.argumentMissing).toBe(false);

  const parsed = parseReminder(routed.argument);
  expect(parsed, example).toMatchObject({ ok: true });
  if (!parsed.ok) return;
  // UTF-16 code units (Requirement 2.15).
  const length = parsed.text.length;
  expect(length).toBeGreaterThanOrEqual(1);
  expect(length).toBeLessThanOrEqual(REMINDER_TEXT_MAX);

  const resolved = resolveDueTime(parsed.expr, t);
  expect(resolved, `${example} at ${t}`).toMatchObject({ ok: true });
}

describe('Time_Help examples', () => {
  // Feature: sms-reminders, Property 27: Time_Help examples always resolve
  // **Validates: Requirements 9.5**
  it('9.5 every Time_Help example routes to REMIND, parses and resolves for any receive time', () => {
    expect(EXAMPLES.length).toBeGreaterThan(0);
    // Each example gets its own full run of receive times.
    for (const example of EXAMPLES) {
      fc.assert(
        fc.property(receiveTime, (t) => checkExample(example, t)),
        REMINDER_PBT_OPTIONS,
      );
    }
  });
});
