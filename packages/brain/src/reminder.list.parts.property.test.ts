// Feature: sms-reminders, Property 20: LIST replies fit 3 parts and show every reminder
// **Validates: Requirements 6.2, 6.3, 6.4**
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { splitSms } from './sms.js';
import { formatWhen } from './reminder.clock.js';
import { formatReminderList } from './reminder.list.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import { REMINDER_TEXT_MAX, type Reminder, type ReminderSlot } from './reminder.types.js';
import { REMINDER_PBT_OPTIONS, reminder, reminderText } from './reminder.arbitraries.js';
import type { Language } from './router.types.js';

const LANGUAGES: readonly Language[] = ['en', 'ur', 'roman-ur'];
const SLOTS: readonly ReminderSlot[] = [1, 2, 3, 4, 5];
const FULL_PREVIEW = 20;
const MAX_PARTS = 3;
const SEPARATOR = '; ';

/** Exactly `REMINDER_TEXT_MAX` UTF-16 code units from `units`, trimmed, padded with `pad`. */
const atLimit = (units: readonly string[], pad: string): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...units), { minLength: REMINDER_TEXT_MAX, maxLength: REMINDER_TEXT_MAX })
    .map((drawn) => {
      let text = '';
      for (const unit of drawn) {
        if (text.length + unit.length > REMINDER_TEXT_MAX) break;
        text += unit;
      }
      text = text.trim();
      while (text.length < REMINDER_TEXT_MAX) text += pad;
      return text;
    });

/** Shared Reminder_Texts plus long UCS-2 and emoji texts at the 140-unit limit. */
const listText: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: reminderText, weight: 3 },
  { arbitrary: atLimit(['ا', 'ب', 'ک', 'م', 'ے', ' '], 'ب'), weight: 1 },
  { arbitrary: atLimit(['😀', '👍', '🙏', '💊', '🌙', 'ب', ' '], 'ب'), weight: 1 },
);

/** 1 to 5 Reminders of one Canonical_Number with distinct slots; Due_Times sometimes shared. */
const senderReminders: fc.Arbitrary<Reminder[]> = fc
  .tuple(fc.shuffledSubarray([...SLOTS], { minLength: 1, maxLength: 5 }), fc.boolean())
  .chain(([slots, shareDue]) =>
    fc.tuple(...slots.map(() => fc.tuple(reminder, listText))).map((drawn) => {
      const first = drawn[0]?.[0];
      return drawn.map(([r, text], i): Reminder => ({
        ...r,
        number: first?.number ?? r.number,
        slot: slots[i] ?? 1,
        text,
        dueAt: shareDue && first !== undefined ? first.dueAt : r.dueAt,
      }));
    }),
  );

const head = (r: Reminder, language: Language): string =>
  `${String(r.slot)}) ${formatWhen(r.dueAt, language)}`;
const codePoints = (text: string): string[] => Array.from(text);
const fits = (text: string): boolean => splitSms(text).length <= MAX_PARTS;

/** The reply with one shared preview length (design, List_Formatter); used for maximality. */
function replyAt(sorted: readonly Reminder[], language: Language, length: number): string {
  const entries = sorted.map((r) => {
    const shown = codePoints(r.text).slice(0, length).join('');
    return shown === '' ? head(r, language) : `${head(r, language)} ${shown}`;
  });
  return REMINDER_TEXTS[language].listLead + entries.join(SEPARATOR);
}

describe('Property 20: LIST replies fit 3 parts and show every reminder', () => {
  it('6.4: 1 to 5 reminders in any Language give 1 to 3 parts with every slot and time, ordered, with one shared preview length', () => {
    fc.assert(
      fc.property(senderReminders, fc.constantFrom(...LANGUAGES), (reminders, language) => {
        const reply = formatReminderList(reminders, language);

        // 6.4: 1 to 3 Reply_Parts.
        const parts = splitSms(reply);
        expect(parts.length).toBeGreaterThanOrEqual(1);
        expect(parts.length).toBeLessThanOrEqual(MAX_PARTS);

        // 6.2: one entry per reminder, in (dueAt, slot) order, each with its slot and time.
        const lead = REMINDER_TEXTS[language].listLead;
        expect(reply.startsWith(lead)).toBe(true);
        const entries = reply.slice(lead.length).split(SEPARATOR);
        const sorted = [...reminders].sort((a, b) => a.dueAt - b.dueAt || a.slot - b.slot);
        expect(entries).toHaveLength(sorted.length);

        // 6.2, 6.3: each preview is leading code points of its text, with one shared length.
        const truncated = new Set<number>();
        let longestWhole = 0;
        sorted.forEach((r, i) => {
          const entry = entries[i] ?? '';
          const h = head(r, language);
          expect(entry.startsWith(h)).toBe(true);
          const rest = entry.slice(h.length);
          const shown = rest === '' ? '' : rest.slice(1);
          if (rest !== '') expect(rest.startsWith(' ')).toBe(true);
          const shownPoints = codePoints(shown);
          const textPoints = codePoints(r.text);
          expect(textPoints.slice(0, shownPoints.length).join('')).toBe(shown);
          expect(shownPoints.length).toBeLessThanOrEqual(FULL_PREVIEW);
          if (shownPoints.length < textPoints.length) truncated.add(shownPoints.length);
          else longestWhole = Math.max(longestWhole, textPoints.length);
        });
        expect(truncated.size).toBeLessThanOrEqual(1);
        const shared = truncated.size === 1 ? [...truncated][0] ?? 0 : FULL_PREVIEW;
        expect(longestWhole).toBeLessThanOrEqual(shared);
        expect(replyAt(sorted, language, shared)).toBe(reply);

        // 6.3: the shared length is the largest from 0 to 20 that fits.
        if (shared < FULL_PREVIEW) {
          expect(fits(replyAt(sorted, language, shared + 1))).toBe(false);
        }
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
