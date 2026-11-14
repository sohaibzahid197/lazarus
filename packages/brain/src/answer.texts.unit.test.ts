import { describe, expect, it } from 'vitest';
import { createMockClient } from './ai.mock.js';
import { AI_ERROR_KINDS, AiError, isAiError, toAiError } from './ai.types.js';
import type { Prompt } from './ai.types.js';
import { FIXED_TEXTS } from './answer.texts.js';
import type { FixedTexts } from './answer.texts.js';
import { splitSms } from './index.js';
import { LANGUAGES } from './router.types.js';

const PROMPT: Prompt = { system: 'system rules', user: 'question' };
const LATIN_LETTER = /[A-Za-z\u00C0-\u024F]/u;
const ARABIC_SCRIPT = /\p{Script=Arabic}/u;
const NON_ARABIC_LETTER = /(?!\p{Script=Arabic})\p{L}/u;
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;

/** Every fixed string of one Language, in a flat list. */
function allTexts(t: FixedTexts): string[] {
  return [
    t.tryLater,
    t.promptForQuestion,
    t.promptForScamText,
    t.uncertainty,
    ...Object.values(t.referral),
    ...Object.values(t.scamWord),
    ...Object.values(t.scamReason),
  ];
}

describe('isAiError and toAiError', () => {
  it('recognises AiError of every kind and rejects other values', () => {
    for (const kind of AI_ERROR_KINDS) {
      const e = new AiError(kind);
      expect(isAiError(e)).toBe(true);
      expect(e.kind).toBe(kind);
      expect(e.name).toBe('AiError');
    }
    for (const v of [new Error('x'), { kind: 'quota' }, 'quota', null, undefined, 0]) {
      expect(isAiError(v)).toBe(false);
    }
  });

  it('returns an AiError unchanged', () => {
    const e = new AiError('network', 'detail');
    expect(toAiError(e)).toBe(e);
  });

  it('maps foreign values to kind unknown and drops their message', () => {
    for (const v of [new Error('secret-123'), 'secret-123', { message: 'secret-123' }, null]) {
      const e = toAiError(v);
      expect(e).toBeInstanceOf(AiError);
      expect(e.kind).toBe('unknown');
      expect(e.message).not.toContain('secret-123');
    }
  });
});

describe('createMockClient', () => {
  it('resolves a text step', async () => {
    await expect(createMockClient([{ text: 'hi' }]).complete(PROMPT)).resolves.toBe('hi');
  });

  it('rejects with the AiError of an error step', async () => {
    const e = new AiError('quota');
    await expect(createMockClient([{ error: e }]).complete(PROMPT)).rejects.toBe(e);
  });

  it('rejects with the raw value of a reject step', async () => {
    const raw = new Error('raw');
    await expect(createMockClient([{ reject: raw }]).complete(PROMPT)).rejects.toBe(raw);
  });

  it('throws synchronously on a throws step', () => {
    const client = createMockClient([{ throws: 'sync' }]);
    let thrown: unknown;
    try {
      void client.complete(PROMPT);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe('sync');
  });

  it('resolves a non-string value step as is', async () => {
    const result: unknown = await createMockClient([{ value: 42 }]).complete(PROMPT);
    expect(result).toBe(42);
  });

  it('never settles on a hang step', async () => {
    const pending = createMockClient([{ hang: true }]).complete(PROMPT).then(() => 'settled');
    const timer = new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 20));
    await expect(Promise.race([pending, timer])).resolves.toBe('pending');
  });

  it('consumes steps in order and repeats the last step', async () => {
    const e = new AiError('timeout');
    const client = createMockClient([{ error: e }, { text: 'ok' }]);
    await expect(client.complete(PROMPT)).rejects.toBe(e);
    await expect(client.complete(PROMPT)).resolves.toBe('ok');
    await expect(client.complete(PROMPT)).resolves.toBe('ok');
  });

  it('records every prompt in call order, including failing calls', async () => {
    const client = createMockClient([{ error: new AiError('network') }, { text: 'ok' }]);
    const first: Prompt = { system: 's1', user: 'u1' };
    const second: Prompt = { system: 's2', user: 'u2' };
    await client.complete(first).catch(() => undefined);
    await client.complete(second);
    expect(client.calls).toEqual([first, second]);
  });
});

describe('FIXED_TEXTS', () => {
  it('has Urdu-script-only letters in every ur text', () => {
    for (const text of allTexts(FIXED_TEXTS.ur)) {
      expect(text, text).not.toMatch(LATIN_LETTER);
      expect(text, text).not.toMatch(NON_ARABIC_LETTER);
    }
  });

  it('has Latin-only letters in every roman-ur text', () => {
    for (const text of allTexts(FIXED_TEXTS['roman-ur'])) {
      expect(text, text).not.toMatch(ARABIC_SCRIPT);
      expect(text, text).not.toMatch(NON_LATIN_LETTER);
    }
  });

  it.each(LANGUAGES)('tryLater for %s is non-blank and fits 1 SMS part', (lang) => {
    const { tryLater } = FIXED_TEXTS[lang];
    expect(tryLater.trim()).not.toBe('');
    expect(splitSms(tryLater)).toHaveLength(1);
  });

  it.each(LANGUAGES)('no %s fixed text contains a newline', (lang) => {
    for (const text of allTexts(FIXED_TEXTS[lang])) {
      expect(text, text).not.toMatch(/[\r\n]/);
    }
  });

  it.each(LANGUAGES)('no %s referral or note is a substring of another fixed text', (lang) => {
    const t = FIXED_TEXTS[lang];
    const texts = allTexts(t);
    const needles = [t.uncertainty, ...Object.values(t.referral)];
    for (const needle of needles) {
      const containing = texts.filter((text) => text.includes(needle));
      expect(containing, needle).toEqual([needle]);
    }
  });

  it.each(LANGUAGES)('%s verdict words contain no colon', (lang) => {
    for (const word of Object.values(FIXED_TEXTS[lang].scamWord)) {
      expect(word.trim()).not.toBe('');
      expect(word, word).not.toMatch(/[:\uFF1A]/);
    }
  });
});
