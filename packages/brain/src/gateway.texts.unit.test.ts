import { describe, expect, it } from 'vitest';
import { ALIAS_TABLE } from './aliases.js';
import { detectEncoding } from './encoding.js';
import { GATEWAY_TEXTS } from './gateway.texts.js';
import type { GatewayTexts } from './gateway.texts.js';
import { routeCommand } from './router.js';
import { LANGUAGES } from './router.types.js';
import type { Command, Language } from './router.types.js';
import { splitSms } from './sms.js';

const LATIN_LETTER = /\p{Script=Latin}/u;
const NON_ARABIC_LETTER = /(?!\p{Script=Arabic})\p{L}/u;
const USAGE_COMMANDS = ['SCAM', 'REMIND', 'TRANSLATE'] as const;
const EDGE_PUNCT = /^[.,!?:;،۔<>]+|[.,!?:;،۔<>]+$/gu;
const SENTENCE_END = /[.۔]/u;
const SOON: Readonly<Record<Language, string>> = { en: 'soon', 'roman-ur': 'jald', ur: 'جلد' };
interface FoundKeyword {
  readonly keyword: string;
  readonly command: Command;
}
/** Every word of a text that is a Keyword of ALIAS_TABLE, with its Command. */
function keywordsIn(text: string): FoundKeyword[] {
  const found: FoundKeyword[] = [];
  for (const word of text.split(/\s+/u)) {
    const keyword = word.replace(EDGE_PUNCT, '');
    const command = ALIAS_TABLE.get(keyword.toLowerCase());
    if (command !== undefined) found.push({ keyword, command });
  }
  return found;
}
/** A minimal message that starts with the keyword and is a full command. */
function messageFor({ keyword, command }: FoundKeyword): string {
  return command === 'LIST' ? keyword : `${keyword} 1`;
}
/** The sentences of the Help_Text that contain a Keyword of the Command. */
function helpSentencesNaming(language: Language, command: Command): string[] {
  return GATEWAY_TEXTS[language].help
    .split(SENTENCE_END)
    .filter((s) => keywordsIn(s).some((k) => k.command === command));
}

interface NamedText {
  readonly name: string;
  readonly text: string;
}

/** Every Fixed_Gateway_Text of one Language, with a name for failure messages. */
function allTexts(t: GatewayTexts): NamedText[] {
  return [
    { name: 'help', text: t.help },
    { name: 'slowDown', text: t.slowDown },
    { name: 'welcomeBack', text: t.welcomeBack },
    { name: 'notAvailable', text: t.notAvailable },
    ...USAGE_COMMANDS.map((c) => ({ name: `usage.${c}`, text: t.usage[c] })),
  ];
}

/** The example part of a usage hint: the text after its last ": ". */
function exampleOf(hint: string): string {
  const at = hint.lastIndexOf(': ');
  expect(at, hint).toBeGreaterThan(0);
  return hint.slice(at + 2);
}

describe('GATEWAY_TEXTS (Req 6.11, 18.1; sms-reminders 9.6, 9.8)', () => {
  it('has texts for exactly the 3 Languages', () => {
    expect(Object.keys(GATEWAY_TEXTS).sort()).toEqual([...LANGUAGES].sort());
  });

  describe.each(LANGUAGES)('Language %s', (language: Language) => {
    const texts = allTexts(GATEWAY_TEXTS[language]);

    it('has no empty text and no newline', () => {
      for (const { name, text } of texts) {
        expect(text.trim(), name).not.toBe('');
        expect(text, name).not.toMatch(/[\r\n]/);
      }
    });

    it('uses the encoding of its Language', () => {
      for (const { name, text } of texts) {
        if (language === 'ur') {
          expect(detectEncoding(text), name).toBe('UCS-2');
          expect(text, name).not.toMatch(LATIN_LETTER);
          expect(text, name).not.toMatch(NON_ARABIC_LETTER);
        } else {
          expect(detectEncoding(text), name).toBe('GSM-7');
        }
      }
    });

    it('fits 1 SMS part (ur Help_Text at most 2)', () => {
      for (const { name, text } of texts) {
        const max = language === 'ur' && name === 'help' ? 2 : 1;
        const parts = splitSms(text);
        expect(parts.length, name).toBeGreaterThanOrEqual(1);
        expect(parts.length, name).toBeLessThanOrEqual(max);
      }
    });

    it('uses every Keyword, LIST and CANCEL included, as a Keyword of its Language (sms-reminders 9.6)', () => {
      for (const { name, text } of texts) {
        for (const found of keywordsIn(text)) {
          const routed = routeCommand(messageFor(found));
          expect(routed.command, `${name}: ${found.keyword}`).toBe(found.command);
          expect(routed.language, `${name}: ${found.keyword}`).toBe(language);
        }
      }
    });
    it('Help_Text names REMIND and LIST as available and TRANSLATE as coming soon (sms-reminders 9.8)', () => {
      const remind = helpSentencesNaming(language, 'REMIND');
      expect(remind.length).toBeGreaterThan(0);
      for (const s of remind) expect(s).not.toContain(SOON[language]);
      expect(helpSentencesNaming(language, 'LIST').length).toBeGreaterThan(0);
      const translate = helpSentencesNaming(language, 'TRANSLATE');
      expect(translate.length).toBeGreaterThan(0);
      for (const s of translate) expect(s).toContain(SOON[language]);
    });
    it.each(USAGE_COMMANDS)('routes the %s usage hint and its example to that Command', (command) => {
      const hint = GATEWAY_TEXTS[language].usage[command];
      expect(routeCommand(hint).command, hint).toBe(command);

      const example = exampleOf(hint);
      const routed = routeCommand(example);
      expect(routed.command, example).toBe(command);
      expect(routed.argumentMissing, example).toBe(false);
    });
  });
});
