// List_Formatter (sms-reminders design, "List_Formatter"; Requirement 6).
// Pure: builds the LIST reply from the sender's Active_Reminders.
import { formatWhen } from './reminder.clock.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import type { Reminder } from './reminder.types.js';
import type { Language } from './router.types.js';
import { splitSms } from './sms.js';

/** Full preview length in code points (6.2). */
const FULL_PREVIEW = 20;
/** Largest Reply_Parts count a LIST reply may give (6.3, 6.4). */
const MAX_LIST_PARTS = 3;

const byDueThenSlot = (a: Reminder, b: Reminder): number => a.dueAt - b.dueAt || a.slot - b.slot;

/** First `length` code points of `text`, unchanged; never splits a surrogate pair. */
const preview = (text: string, length: number): string =>
  Array.from(text).slice(0, length).join('');

/** `<slot>) <when> <preview>`, or `<slot>) <when>` when the preview is empty. */
function entry(r: Reminder, language: Language, length: number): string {
  const head = `${r.slot}) ${formatWhen(r.dueAt, language)}`;
  const shown = preview(r.text, length);
  return shown === '' ? head : `${head} ${shown}`;
}

function listReply(sorted: readonly Reminder[], language: Language, length: number): string {
  const entries = sorted.map((r) => entry(r, language, length));
  return REMINDER_TEXTS[language].listLead + entries.join('; ');
}

/**
 * LIST reply for the sender's Active_Reminders (1 to 5), sorted by
 * `(dueAt, slot)`. Uses one shared preview length: 20 code points when the
 * reply fits 3 parts, otherwise the largest length from 19 down to 0 that
 * fits. `splitSms` caps at 4 parts, so "more than 3" is still detected.
 * The caller passes only `activeFor(state, sender)` (6.6).
 */
export function formatReminderList(
  reminders: readonly Reminder[],
  language: Language,
  split: (text: string) => string[] = splitSms,
): string {
  const sorted = [...reminders].sort(byDueThenSlot);
  for (let length = FULL_PREVIEW; length > 0; length -= 1) {
    const reply = listReply(sorted, language, length);
    if (split(reply).length <= MAX_LIST_PARTS) {
      return reply;
    }
  }
  return listReply(sorted, language, 0);
}
