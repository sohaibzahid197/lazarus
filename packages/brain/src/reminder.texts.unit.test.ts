import { describe, expect, it } from 'vitest';
import { ALIAS_TABLE } from './aliases.js';
import { GSM_7_BASIC } from './encoding.js';
import { formatWhen } from './reminder.clock.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import type { ReminderTexts } from './reminder.texts.js';
import type { ReminderSlot } from './reminder.types.js';
import { routeCommand } from './router.js';
import { LANGUAGES } from './router.types.js';
import type { Command, Language } from './router.types.js';
import { splitSms } from './sms.js';

const SLOTS: readonly ReminderSlot[] = [1, 2, 3, 4, 5];
const PK_OFFSET_MS = 5 * 3_600_000;
const TIMES: readonly (readonly [number, number])[] = [
  [0, 0],
  [12, 59],
  [23, 59],
];
const REMINDER_COMMANDS: ReadonlySet<Command> = new Set<Command>(['REMIND', 'LIST', 'CANCEL']);
const EDGE_PUNCT = /^\p{P}+|\p{P}+$/gu;
const URDU_ALLOWED = /^[\p{Script_Extensions=Arabic}0-9\p{P} ]$/u;

interface NamedText {
  readonly name: string;
  readonly text: string;
}

/** Epoch ms of a Pakistan_Time wall clock (UTC+5, no DST). 2024 is a leap year. */
function pkTime(month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(2024, month - 1, day, hour, minute) - PK_OFFSET_MS;
}

/** Every valid date of 2024: covers days 1 to 31 and months 1 to 12. */
function allDates(): (readonly [number, number])[] {
  const dates: (readonly [number, number])[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const days = new Date(Date.UTC(2024, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day += 1) dates.push([month, day]);
  }
  return dates;
}

/** Every Reminder_Set_Text over all slots, dates and the 3 boundary times. */
function allSetTexts(language: Language): NamedText[] {
  const texts: NamedText[] = [];
  const set = REMINDER_TEXTS[language].set;
  for (const [month, day] of allDates()) {
    for (const [hour, minute] of TIMES) {
      const when = formatWhen(pkTime(month, day, hour, minute), language);
      for (const slot of SLOTS) texts.push({ name: `set(${slot}, ${when})`, text: set(slot, when) });
    }
  }
  return texts;
}

/** Every single-part Reminder_Texts item (all but timeHelp and deliveryLead). */
function onePartTexts(t: ReminderTexts): NamedText[] {
  return [
    { name: 'past', text: t.past },
    { name: 'tooFar', text: t.tooFar },
    { name: 'tooLong', text: t.tooLong },
    { name: 'limit', text: t.limit },
    { name: 'noReminders', text: t.noReminders },
    { name: 'noSuch', text: t.noSuch },
    { name: 'cancelUsage', text: t.cancelUsage },
    { name: 'cancelExample', text: t.cancelExample },
    { name: 'unavailable', text: t.unavailable },
    { name: 'listLead', text: t.listLead },
    ...SLOTS.map((n) => ({ name: `cancelled(${n})`, text: t.cancelled(n) })),
    ...t.months.map((m, i) => ({ name: `months[${i}]`, text: m })),
  ];
}

/** Every Reminder_Texts item of one Language, functions sampled at slot 1..5. */
function allTexts(language: Language): NamedText[] {
  const t = REMINDER_TEXTS[language];
  const when = formatWhen(pkTime(1, 15, 20, 0), language);
  return [
    ...onePartTexts(t),
    ...SLOTS.map((n) => ({ name: `set(${n})`, text: t.set(n, when) })),
    { name: 'timeHelp', text: t.timeHelp },
    ...t.timeHelpExamples.map((e, i) => ({ name: `timeHelpExamples[${i}]`, text: e })),
    { name: 'deliveryLead', text: t.deliveryLead },
  ];
}

/** Tokens of a text with edge punctuation removed. */
function tokensOf(text: string): string[] {
  return text
    .split(/\s+/u)
    .map((w) => w.replace(EDGE_PUNCT, ''))
    .filter((w) => w !== '');
}

/** REMIND, LIST and CANCEL keyword tokens that appear in a text. */
function reminderKeywords(text: string): { token: string; command: Command }[] {
  const found: { token: string; command: Command }[] = [];
  for (const token of tokensOf(text)) {
    const command = ALIAS_TABLE.get(token.toLowerCase());
    if (command !== undefined && REMINDER_COMMANDS.has(command)) found.push({ token, command });
  }
  return found;
}

function isAliasToken(token: string): boolean {
  return ALIAS_TABLE.has(token.toLowerCase());
}

/** Characters of a `ur` text that are not Urdu script, ASCII digit, space or punctuation and not in a keyword. */
function badUrduChars(text: string): string[] {
  const bad: string[] = [];
  for (const raw of text.split(' ')) {
    if (isAliasToken(raw.replace(EDGE_PUNCT, ''))) continue;
    for (const ch of raw) if (!URDU_ALLOWED.test(ch)) bad.push(ch);
  }
  return bad;
}

function toAsciiDigits(s: string): string {
  return s.replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

describe('REMINDER_TEXTS (Req 5.2, 9.1, 9.2, 9.3, 9.4, 9.6)', () => {
  it('has texts for exactly the 3 Languages', () => {
    expect(Object.keys(REMINDER_TEXTS).sort()).toEqual([...LANGUAGES].sort());
  });

  describe.each(LANGUAGES)('Language %s', (language: Language) => {
    const t = REMINDER_TEXTS[language];
    const texts = allTexts(language);

    it('9.1 has no empty item and no newline', () => {
      expect(t.months).toHaveLength(12);
      for (const { name, text } of texts) {
        expect(text.trim(), name).not.toBe('');
        expect(text, name).not.toMatch(/[\r\n]/);
      }
    });

    it('9.2 uses only the characters allowed for its Language', () => {
      for (const { name, text } of [...texts, ...allSetTexts(language)]) {
        if (language === 'ur') {
          expect(badUrduChars(text), `${name}: ${text}`).toEqual([]);
        } else {
          const bad = [...text].filter((ch) => !GSM_7_BASIC.has(ch));
          expect(bad, `${name}: ${text}`).toEqual([]);
        }
      }
    });

    it('9.3 every item except timeHelp and deliveryLead fits exactly 1 part', () => {
      for (const { name, text } of onePartTexts(t)) {
        expect(splitSms(text), name).toHaveLength(1);
      }
    });

    it('9.3, 5.2 the Reminder_Set_Text fits 1 part for slots 1-5, every date and 00:00, 12:59, 23:59', () => {
      for (const { name, text } of allSetTexts(language)) {
        expect(splitSms(text), `${name}: ${text}`).toHaveLength(1);
      }
    });

    it('5.2 the Reminder_Set_Text shows the slot and the Due_Time as day, month and H:MM', () => {
      for (const [month, day] of allDates()) {
        for (const [hour, minute] of TIMES) {
          const when = formatWhen(pkTime(month, day, hour, minute), language);
          const mm = String(minute).padStart(2, '0');
          expect(when).toBe(`${day} ${t.months[month - 1] ?? ''} ${hour}:${mm}`);
          for (const slot of SLOTS) {
            const text = t.set(slot, when);
            expect(text).toContain(when);
            expect(text).toContain(String(slot));
          }
        }
      }
    });

    it('5.2 the Reminder_Set_Text contains no part of the Reminder_Text', () => {
      expect(t.set.length).toBe(2);
      const samples = ['take medicine', 'call Ali', 'dawai leni hai', 'دوا لینی ہے', 'pani piyen', 'XYZZY'];
      const when = formatWhen(pkTime(3, 9, 8, 5), language);
      for (const slot of SLOTS) {
        const text = t.set(slot, when);
        for (const sample of samples) expect(text, sample).not.toContain(sample);
      }
    });

    it('9.4 the Time_Help_Text has at least 2 examples and 1 or 2 parts', () => {
      expect(t.timeHelpExamples.length).toBeGreaterThanOrEqual(2);
      for (const example of t.timeHelpExamples) expect(t.timeHelp).toContain(example);
      const parts = splitSms(t.timeHelp);
      expect(parts.length).toBeGreaterThanOrEqual(1);
      expect(parts.length).toBeLessThanOrEqual(2);
    });

    it('9.6 every REMIND, LIST or CANCEL keyword in a text routes to its Command in that Language', () => {
      for (const { name, text } of [...texts, ...allSetTexts(language)]) {
        for (const { token, command } of reminderKeywords(text)) {
          const message = command === 'LIST' ? token : `${token} 1`;
          const routed = routeCommand(message);
          expect(routed.command, `${name}: ${message}`).toBe(command);
          expect(routed.language, `${name}: ${message}`).toBe(language);
        }
      }
    });

    it('9.6 cancelExample appears in cancelUsage and routes to CANCEL with 1 to 5', () => {
      expect(t.cancelUsage).toContain(t.cancelExample);
      const routed = routeCommand(t.cancelExample);
      expect(routed.command).toBe('CANCEL');
      expect(routed.argumentMissing).toBe(false);
      expect(routed.language).toBe(language);
      const n = Number(toAsciiDigits(routed.argument));
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(5);
    });
  });
});
