// Feature: sms-reminders, Property 28: Reminder_Delivery_Text fits 1 to 3 parts
// **Validates: Requirements 9.7**
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { splitSms } from './sms.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import { REMINDER_TEXT_MAX } from './reminder.types.js';
import { REMINDER_PBT_OPTIONS, reminderText } from './reminder.arbitraries.js';
import type { Language } from './router.types.js';

const LANGUAGES: readonly Language[] = ['en', 'ur', 'roman-ur'];

/** UCS-2 BMP characters outside GSM-7 (Urdu script and CJK). */
const UCS2_CHARS: readonly string[] = ['ا', 'ب', 'ک', 'م', 'ے', '中', '文'];
/** Emoji outside the BMP: each is one code point but two UTF-16 code units. */
const SURROGATE_EMOJI: readonly string[] = ['😀', '👍', '🙏', '💊', '🌙', '🚀'];
/** GSM-7 extension-table characters: each costs 2 septets. */
const GSM_EXTENSION: readonly string[] = ['{', '}', '[', ']', '~', '|', '^', '€', '\\'];

/** A space inside the text moves cuts back to word boundaries (worst case for part count). */
const SPACE: readonly string[] = [' '];
/** Every kind of character above, plus spaces and GSM-7 basic letters. */
const MIXED: readonly string[] = [...UCS2_CHARS, ...SURROGATE_EMOJI, ...GSM_EXTENSION, ...SPACE, 'a', 'Z'];

/**
 * Exactly `REMINDER_TEXT_MAX` UTF-16 code units drawn from `chars`, with no
 * leading or trailing space (a parser-accepted Reminder_Text). When the next
 * character would pass the limit, the text is topped up with 1-unit
 * characters from `fill`.
 */
const fullLength = (chars: readonly string[], fill: readonly string[] = ['x']): fc.Arbitrary<string> =>
  fc
    .tuple(
      fc.array(fc.constantFrom(...chars), {
        minLength: REMINDER_TEXT_MAX,
        maxLength: REMINDER_TEXT_MAX,
      }),
      fc.constantFrom(...fill),
    )
    .map(([units, pad]) => {
      let text = '';
      for (const unit of units) {
        if (text.length + unit.length > REMINDER_TEXT_MAX) break;
        text += unit;
      }
      text = text.trim();
      while (text.length < REMINDER_TEXT_MAX) text += pad;
      return text;
    });

/** Shared Reminder_Texts plus texts filled to the limit for each encoding. */
const deliveryReminderText: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: reminderText, weight: 3 },
  { arbitrary: fullLength(UCS2_CHARS), weight: 1 },
  { arbitrary: fullLength(SURROGATE_EMOJI, ['ب']), weight: 1 },
  { arbitrary: fullLength(GSM_EXTENSION, ['{']), weight: 1 },
  { arbitrary: fullLength(MIXED), weight: 2 },
);

const PART_PREFIX = /^\((\d+)\/(\d+)\) /;

/** Removes the `(i/n) ` prefix of each part (only present when n > 1) and joins them. */
function joinWithoutPrefixes(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0] ?? '';
  return parts
    .map((part, index) => {
      const match = PART_PREFIX.exec(part);
      expect(match?.[1]).toBe(String(index + 1));
      expect(match?.[2]).toBe(String(parts.length));
      return part.slice(match?.[0].length ?? 0);
    })
    .join('');
}

/**
 * The tightest case: the longest deliveryLead ("Yaad dahani: ", 13 units) and
 * a 140-unit UCS-2 text where each of the first 2 parts loses 1 unit to a
 * surrogate pair and 14 to a word boundary, so each holds only 46 units and
 * the last 61 units exactly fill part 3.
 */
function worstCaseText(lead: string): string {
  const units: string[] = Array.from({ length: lead.length + REMINDER_TEXT_MAX }, () => 'ب');
  for (const start of [0, 46]) {
    units[start + 45] = ' ';
    // The high surrogate sits at the last budget unit (60), forcing a 1-unit back-off.
    units[start + 60] = '😀';
    units[start + 61] = '';
  }
  return units.join('').slice(lead.length);
}

describe('Property 28: Reminder_Delivery_Text fits 1 to 3 parts', () => {
  it('9.7: the worst-case 140-unit text after the longest lead still fits 3 parts', () => {
    const lead = REMINDER_TEXTS['roman-ur'].deliveryLead;
    const text = worstCaseText(lead);
    expect(text).toHaveLength(REMINDER_TEXT_MAX);
    const parts = splitSms(lead + text);
    expect(parts.map((part) => part.length)).toEqual([52, 52, 67]);
    expect(joinWithoutPrefixes(parts)).toBe(lead + text);
  });

  it('9.7: for every Language, lead-in + Reminder_Text splits into 1 to 3 parts that join back unchanged', () => {
    fc.assert(
      fc.property(deliveryReminderText, fc.constantFrom(...LANGUAGES), (text, language) => {
        const lead = REMINDER_TEXTS[language].deliveryLead;
        const delivery = lead + text;
        const parts = splitSms(delivery);

        expect(parts.length).toBeGreaterThanOrEqual(1);
        expect(parts.length).toBeLessThanOrEqual(3);

        const joined = joinWithoutPrefixes(parts);
        expect(joined).toBe(delivery);
        expect(joined.startsWith(lead)).toBe(true);
        expect(joined.slice(lead.length)).toBe(text);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
