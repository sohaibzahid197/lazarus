// Property-based tests for the Topic_Classifier (`answer.topic.ts`).
//
// Each property runs at least 100 fast-check iterations (PBT_OPTIONS) and is
// tagged with its design property number and the requirements it validates.
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { asksForLiveFacts, asksForPriceOrRate, classifyTopic } from './answer.topic.js';
import { LIVE_FACT_KEYWORDS, PRICE_KEYWORDS, TOPIC_KEYWORDS } from './answer.texts.js';
import type { Language, Topic } from './answer.types.js';
import {
  PBT_OPTIONS,
  anyInputTextArb,
  blankTextArb,
  keywordQuestion,
  languageArb,
  liveFactQuestionArb,
  mixedScriptText,
  topicQuestionArb,
} from './answer.arbitraries.js';

const LANGUAGES: readonly Language[] = ['en', 'ur', 'roman-ur'];
const TOPICS: readonly Topic[] = ['health', 'legal', 'money'];

/** Every keyword of every list (topics and live facts), all Languages. */
const ALL_KEYWORDS: readonly string[] = LANGUAGES.flatMap((lang) => [
  ...TOPICS.flatMap((topic) => TOPIC_KEYWORDS[lang][topic]),
  ...LIVE_FACT_KEYWORDS[lang],
]);

/** Keywords written only in lower-case Latin letters and spaces. */
const LATIN_KEYWORDS: readonly string[] = [...new Set(ALL_KEYWORDS)].filter((k) =>
  /^[a-z]+(?: [a-z]+)*$/.test(k),
);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when some Latin keyword appears as a whole word in the lower-cased text. */
function hasWholeWordLatinKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return LATIN_KEYWORDS.some((k) =>
    new RegExp(`(?<![a-z0-9])${escapeRegExp(k)}(?![a-z0-9])`).test(lower),
  );
}

const lettersArb = (minLength: number): fc.Arbitrary<string> =>
  fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), minLength, maxLength: 4 });

/**
 * A Latin keyword glued inside a longer word (at least one extra letter
 * before or after), case-mutated, where no keyword forms as a whole word.
 */
const embeddedInWordArb: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(...LATIN_KEYWORDS), lettersArb(0), lettersArb(0))
  .filter(([, pre, post]) => pre.length + post.length > 0)
  .chain(([keyword, pre, post]) => fc.mixedCase(fc.constant(pre + keyword + post)))
  .filter((text) => !hasWholeWordLatinKeyword(text));

const boundaryArb: fc.Arbitrary<string> = fc.constantFrom(' ', '\n', ', ', '? ', '. ');

describe('Topic_Classifier', () => {
  // Feature: ai-answer-service, Property 8: Classifier matching rules
  // **Validates: Requirements 5.1, 5.5, 6.4, 6.5**
  describe('Property 8: Classifier matching rules', () => {
    it('a topic keyword embedded in keyword-free text, any case, yields that topic', () => {
      fc.assert(
        fc.property(topicQuestionArb, ({ question, topic, language }) => {
          expect(classifyTopic(question, language)).toEqual({ sensitive: true, topic });
        }),
        PBT_OPTIONS,
      );
    });

    it('a topic keyword in arbitrary text yields a topic of equal or higher priority', () => {
      const arb = fc.tuple(
        topicQuestionArb,
        mixedScriptText({ maxLength: 60 }),
        boundaryArb,
        boundaryArb,
        mixedScriptText({ maxLength: 60 }),
      );
      fc.assert(
        fc.property(arb, ([{ question, topic, language }, pre, b1, b2, post]) => {
          const result = classifyTopic(pre + b1 + question + b2 + post, language);
          expect(result.sensitive).toBe(true);
          expect(result.topic).not.toBeNull();
          expect(TOPICS.indexOf(result.topic as Topic)).toBeLessThanOrEqual(TOPICS.indexOf(topic));
        }),
        PBT_OPTIONS,
      );
    });

    it('a live-fact keyword embedded in text, any case, is a live-fact question', () => {
      fc.assert(
        fc.property(liveFactQuestionArb, ({ question, language }) => {
          expect(asksForLiveFacts(question, language)).toBe(true);
        }),
        PBT_OPTIONS,
      );
    });

    it('a price or rate keyword embedded in text, any case, is a price question', () => {
      const arb = languageArb.chain((language) =>
        keywordQuestion(PRICE_KEYWORDS[language]).map((q) => ({ ...q, language })),
      );
      fc.assert(
        fc.property(arb, ({ question, language }) => {
          expect(asksForPriceOrRate(question, language)).toBe(true);
          expect(asksForLiveFacts(question, language)).toBe(true);
        }),
        PBT_OPTIONS,
      );
    });

    it('a Latin keyword inside a longer Latin word does not match', () => {
      fc.assert(
        fc.property(embeddedInWordArb, languageArb, (text, language) => {
          expect(classifyTopic(text, language)).toEqual({ sensitive: false, topic: null });
          expect(asksForLiveFacts(text, language)).toBe(false);
          expect(asksForPriceOrRate(text, language)).toBe(false);
        }),
        PBT_OPTIONS,
      );
    });

    it('blank input is not sensitive and asks for no live facts', () => {
      fc.assert(
        fc.property(blankTextArb, languageArb, (text, language) => {
          expect(classifyTopic(text, language)).toEqual({ sensitive: false, topic: null });
          expect(asksForLiveFacts(text, language)).toBe(false);
          expect(asksForPriceOrRate(text, language)).toBe(false);
        }),
        PBT_OPTIONS,
      );
    });

    it('repeated calls return identical results', () => {
      fc.assert(
        fc.property(anyInputTextArb, languageArb, (text, language) => {
          expect(classifyTopic(text, language)).toEqual(classifyTopic(text, language));
          expect(asksForLiveFacts(text, language)).toBe(asksForLiveFacts(text, language));
          expect(asksForPriceOrRate(text, language)).toBe(asksForPriceOrRate(text, language));
        }),
        PBT_OPTIONS,
      );
    });
  });
});
