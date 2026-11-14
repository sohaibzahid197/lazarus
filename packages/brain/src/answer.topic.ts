// Topic_Classifier: sensitive topics, live-fact questions and invented amounts.
// Pure: no I/O, no clock, same result for the same input.
// _Requirements: 5.1, 5.5, 6.2, 6.3, 6.4, 6.5_
import type { Language, Topic } from './answer.types.js';
import { LIVE_FACT_KEYWORDS, PRICE_KEYWORDS, TOPIC_KEYWORDS } from './answer.texts.js';
import { normalizeMessage } from './normalize.js';

export interface TopicResult {
  readonly sensitive: boolean;
  /** Non-null iff sensitive. */
  readonly topic: Topic | null;
}

/** Fixed priority: the first topic with a keyword hit wins. */
const TOPIC_ORDER: readonly Topic[] = ['health', 'legal', 'money'];

const NOT_SENSITIVE: TopicResult = { sensitive: false, topic: null };

type Matcher = (folded: string) => boolean;

/** Lower-cases only ASCII Latin letters A-Z; every other character is kept. */
function foldLatin(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Latin keywords match as whole words; Urdu-script keywords as substrings. */
function toMatcher(keyword: string): Matcher {
  const lower = foldLatin(keyword);
  if (!/[a-z]/.test(lower)) {
    return (folded) => folded.includes(lower);
  }
  const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(lower)}(?![a-z0-9])`);
  return (folded) => pattern.test(folded);
}

/** The keyword list for the Language plus the English list. */
function listsFor<T>(lists: Readonly<Record<Language, T>>, language: Language): readonly T[] {
  return language === 'en' ? [lists.en] : [lists[language], lists.en];
}

function buildMatchers(keywordLists: readonly (readonly string[])[]): readonly Matcher[] {
  return keywordLists.flat().map(toMatcher);
}

function anyMatch(matchers: readonly Matcher[], text: string): boolean {
  const normalized = normalizeMessage(text);
  if (normalized === '') return false;
  const folded = foldLatin(normalized);
  return matchers.some((match) => match(folded));
}

function perLanguage<T>(build: (language: Language) => T): Readonly<Record<Language, T>> {
  return { en: build('en'), ur: build('ur'), 'roman-ur': build('roman-ur') };
}

const TOPIC_MATCHERS = perLanguage((language) => {
  const lists = listsFor(TOPIC_KEYWORDS, language);
  const byTopic = (topic: Topic): readonly Matcher[] =>
    buildMatchers(lists.map((list) => list[topic]));
  return { health: byTopic('health'), legal: byTopic('legal'), money: byTopic('money') };
});

const LIVE_FACT_MATCHERS = perLanguage((language) =>
  buildMatchers(listsFor(LIVE_FACT_KEYWORDS, language)),
);

const PRICE_MATCHERS = perLanguage((language) =>
  buildMatchers(listsFor(PRICE_KEYWORDS, language)),
);

/** Sensitive_Topic check with fixed priority health, legal, money. */
export function classifyTopic(text: string, language: Language): TopicResult {
  const matchers = TOPIC_MATCHERS[language];
  const topic = TOPIC_ORDER.find((t) => anyMatch(matchers[t], text));
  return topic === undefined ? NOT_SENSITIVE : { sensitive: true, topic };
}

/** True when the text asks for a price, rate, exchange rate, weather, score or news. */
export function asksForLiveFacts(text: string, language: Language): boolean {
  return anyMatch(LIVE_FACT_MATCHERS[language], text);
}

/** True when the text asks for a price or rate (subset of live facts). */
export function asksForPriceOrRate(text: string, language: Language): boolean {
  return anyMatch(PRICE_MATCHERS[language], text);
}

/** Maps Arabic-Indic and Extended Arabic-Indic digits and separators to ASCII. */
function toAsciiDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066C/g, ',')
    .replace(/\u066B/g, '.');
}

/** Digits with optional thousands separators and decimals. */
const NUMBER_PATTERN = /\d+(?:,\d{3})*(?:\.\d+)?/g;

/** A currency marker right before a number. */
const MARKER_BEFORE = /(?:(?<![a-z0-9])(?:rs\.?|pkr|usd|rupees?)|[$€₨]|روپے)\s?$/;

/** A currency marker or percent sign right after a number. */
const MARKER_AFTER = /^\s?(?:%|(?:rs|pkr|usd|rupees?)(?![a-z0-9])|[$€₨]|روپے)/;

/** Removes thousands separators and gives a canonical numeric string. */
function canonicalNumber(raw: string): string {
  const plain = raw.replace(/,/g, '');
  const value = Number(plain);
  return Number.isFinite(value) ? String(value) : plain;
}

function prepare(text: string): string {
  return foldLatin(toAsciiDigits(normalizeMessage(text)));
}

function allNumbers(prepared: string): ReadonlySet<string> {
  return new Set(Array.from(prepared.matchAll(NUMBER_PATTERN), (m) => canonicalNumber(m[0])));
}

function amounts(prepared: string): readonly string[] {
  return Array.from(prepared.matchAll(NUMBER_PATTERN))
    .filter((m) => {
      const start = m.index;
      const before = prepared.slice(0, start);
      const after = prepared.slice(start + m[0].length);
      return MARKER_BEFORE.test(before) || MARKER_AFTER.test(after);
    })
    .map((m) => canonicalNumber(m[0]));
}

/**
 * True when `modelText` has a currency amount or percentage whose number does
 * not appear among the numbers in `question`.
 */
export function containsUnsupportedAmount(modelText: string, question: string): boolean {
  const found = amounts(prepare(modelText));
  if (found.length === 0) return false;
  const known = allNumbers(prepare(question));
  return found.some((n) => !known.has(n));
}
