// Shared fast-check generators for the ai-answer-service property tests.
// Reuses `anyTextArb` (splitter) and `anyText`, `urduCharArb`,
// `plainLatinWordArb` (router) where they fit.
import * as fc from 'fast-check';
import { AI_ERROR_KINDS, AiError, type AiErrorKind } from './ai.types.js';
import type { MockStep } from './ai.mock.js';
import type { Language, ScamResult, ScamVerdict, Topic } from './answer.types.js';
import {
  LIVE_FACT_KEYWORDS,
  MAX_REASON_CODE_POINTS,
  REDACTED,
  TOPIC_KEYWORDS,
} from './answer.texts.js';
import { anyTextArb } from './arbitraries.js';
import { normalizeMessage } from './normalize.js';
import { anyText, plainLatinWordArb, urduCharArb } from './router.arbitraries.js';

/** Shared run settings: every property runs at least 100 iterations. */
export const PBT_OPTIONS = { numRuns: 100 } as const;

const LANGUAGES: readonly Language[] = ['en', 'ur', 'roman-ur'];
const TOPICS: readonly Topic[] = ['health', 'legal', 'money'];
const VERDICTS: readonly ScamVerdict[] = ['SCAM', 'SAFE', 'UNSURE'];

export const languageArb: fc.Arbitrary<Language> = fc.constantFrom(...LANGUAGES);
export const aiErrorKindArb: fc.Arbitrary<AiErrorKind> = fc.constantFrom(...AI_ERROR_KINDS);

// ---------------------------------------------------------------------------
// Mixed-script text
// ---------------------------------------------------------------------------

const LATIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DIGITS = '0123456789'.split('');
const OTHER_UNITS: readonly string[] = [
  '.', ',', '?', '!', ':', ';', '-', '(', ')', // punctuation
  '*', '_', '#', '`', // markdown markers
  '[', ']', '{', '}', '€', '^', '~', '|', '\\', // GSM-7 extension chars
  'é', 'ñ', 'â', 'ê', // accented Latin
  '😀', '🎉', '🚀', // surrogate pairs
];
const WHITESPACE_UNITS: readonly string[] = [' ', '\t', '\n', '\r'];

/** One non-whitespace unit: Latin, digit, Urdu script, punctuation, markdown or emoji. */
const visibleUnitArb: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constantFrom(...LATIN), weight: 5 },
  { arbitrary: urduCharArb, weight: 3 },
  { arbitrary: fc.constantFrom(...DIGITS), weight: 1 },
  { arbitrary: fc.constantFrom(...OTHER_UNITS), weight: 1 },
);

const textUnitArb: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: visibleUnitArb, weight: 5 },
  { arbitrary: fc.constantFrom(...WHITESPACE_UNITS), weight: 1 },
);

/** Mixed-script text (Latin, Urdu script, digits, markdown, emoji, whitespace). */
export function mixedScriptText(
  options: { readonly minLength?: number; readonly maxLength?: number } = {},
): fc.Arbitrary<string> {
  return fc.string({
    unit: textUnitArb,
    minLength: options.minLength ?? 0,
    maxLength: options.maxLength ?? 200,
  });
}

export const mixedScriptTextArb: fc.Arbitrary<string> = mixedScriptText();

/** Any input text: mixed script, splitter text, and router text (incl. lone surrogates). */
export const anyInputTextArb: fc.Arbitrary<string> = fc.oneof(
  mixedScriptTextArb,
  anyTextArb,
  anyText,
);

const MARKDOWN_LINES: readonly string[] = [
  '- item', '* item', '• item', '1. step', '## Title', '**bold**', '_soft_', '`code`',
];

/** Model output of 0 to 5,000 characters, with markdown lines and long texts. */
export const modelOutputArb: fc.Arbitrary<string> = fc.oneof(
  mixedScriptText({ maxLength: 300 }),
  fc
    .array(fc.oneof(fc.constantFrom(...MARKDOWN_LINES), mixedScriptText({ maxLength: 80 })), {
      maxLength: 12,
    })
    .map((lines) => lines.join('\n')),
  mixedScriptText({ minLength: 1000, maxLength: 5000 }),
);

// ---------------------------------------------------------------------------
// Whitespace variants
// ---------------------------------------------------------------------------

/** Empty or whitespace-only text. */
export const blankTextArb: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(...WHITESPACE_UNITS, '\u00A0'),
  maxLength: 10,
});

const wsRunArb = (minLength: number): fc.Arbitrary<string> =>
  fc.string({ unit: fc.constantFrom(...WHITESPACE_UNITS), minLength, maxLength: 4 });

const wordArb: fc.Arbitrary<string> = fc.string({
  unit: visibleUnitArb,
  minLength: 1,
  maxLength: 12,
});

/** Toggles the case of A-Z / a-z only; other characters are kept as they are. */
function latinCaseMutate(text: string): fc.Arbitrary<string> {
  const chars = Array.from(text);
  return fc
    .array(fc.boolean(), { minLength: chars.length, maxLength: chars.length })
    .map((flags) =>
      chars
        .map((c, i) => {
          if (flags[i] !== true || !/^[A-Za-z]$/.test(c)) return c;
          return c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
        })
        .join(''),
    );
}

/** One rendering of the words with random whitespace runs and Latin case. */
function renderVariant(words: readonly string[]): fc.Arbitrary<string> {
  return fc
    .tuple(
      wsRunArb(0),
      fc.array(wsRunArb(1), { minLength: words.length, maxLength: words.length }),
      wsRunArb(0),
    )
    .chain(([lead, seps, trail]) =>
      latinCaseMutate(
        lead + words.map((w, i) => (i === 0 ? w : (seps[i] ?? ' ') + w)).join('') + trail,
      ),
    );
}

/**
 * Two texts that differ only in Latin letter case, leading or trailing
 * whitespace and the length or kind of whitespace runs.
 */
export const whitespaceVariantPairArb: fc.Arbitrary<readonly [string, string]> = fc
  .array(wordArb, { maxLength: 8 })
  .chain((words) => fc.tuple(renderVariant(words), renderVariant(words)));

// ---------------------------------------------------------------------------
// Keyword-embedded questions
// ---------------------------------------------------------------------------

const ALL_KEYWORDS: readonly string[] = LANGUAGES.flatMap((lang) => [
  ...TOPICS.flatMap((topic) => TOPIC_KEYWORDS[lang][topic]),
  ...LIVE_FACT_KEYWORDS[lang],
]);

const fillerWordArb: fc.Arbitrary<string> = fc.oneof(
  plainLatinWordArb,
  fc.string({ unit: urduCharArb, minLength: 1, maxLength: 6 }),
  fc.string({ unit: fc.constantFrom(...DIGITS), minLength: 1, maxLength: 3 }),
);

/**
 * Filler text with no keyword of any topic or live-fact list inside it, before or
 * after normalization. The check on `normalizeMessage(text)` matters: Arabic
 * presentation forms (e.g. U+FC20 U+FC0B) expand under NFKC into ordinary letters
 * that can spell a keyword such as صحت, which would change the question's topic.
 */
const fillerArb: fc.Arbitrary<string> = fc
  .array(fillerWordArb, { maxLength: 6 })
  .map((words) => words.join(' '))
  .filter((text) => {
    const forms = [text.toLowerCase(), normalizeMessage(text).toLowerCase()];
    return ALL_KEYWORDS.every((k) => forms.every((f) => !f.includes(k)));
  });

const boundaryArb: fc.Arbitrary<string> = fc.constantFrom(' ', '  ', '\n', ', ', '? ', '. ');

export interface KeywordQuestion {
  readonly keyword: string;
  readonly question: string;
}

/**
 * A question with one keyword from `keywords` embedded as a whole word
 * (Latin letters case-mutated) between filler text that holds no keyword.
 */
export function keywordQuestion(keywords: readonly string[]): fc.Arbitrary<KeywordQuestion> {
  return fc.constantFrom(...keywords).chain((keyword) =>
    fc
      .tuple(fillerArb, boundaryArb, latinCaseMutate(keyword), boundaryArb, fillerArb)
      .map(([pre, b1, kw, b2, post]) => ({ keyword, question: pre + b1 + kw + b2 + post })),
  );
}

export interface TopicQuestion extends KeywordQuestion {
  readonly topic: Topic;
  readonly language: Language;
}

/** A question containing one sensitive-topic keyword, with its topic and list Language. */
export const topicQuestionArb: fc.Arbitrary<TopicQuestion> = fc
  .tuple(languageArb, fc.constantFrom(...TOPICS))
  .chain(([language, topic]) =>
    keywordQuestion(TOPIC_KEYWORDS[language][topic]).map((q) => ({ ...q, topic, language })),
  );

/** A question containing one live-fact keyword (price, rate, weather, score, news). */
export const liveFactQuestionArb: fc.Arbitrary<KeywordQuestion & { readonly language: Language }> =
  languageArb.chain((language) =>
    keywordQuestion(LIVE_FACT_KEYWORDS[language]).map((q) => ({ ...q, language })),
  );

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/**
 * A non-empty Secret with no `[` or `]` that is not a substring of
 * `[redacted]`, so redaction output can never re-form a Secret.
 */
export const secretArb: fc.Arbitrary<string> = fc
  .oneof(
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.string({ unit: visibleUnitArb, minLength: 1, maxLength: 40 }),
    fc.string({ unit: fc.constantFrom(...LATIN, ...DIGITS, '_', '-'), minLength: 20, maxLength: 60 }),
  )
  .filter((s) => !s.includes('[') && !s.includes(']') && !REDACTED.includes(s));

/** Zero to three Secrets. */
export const secretsArb: fc.Arbitrary<readonly string[]> = fc.array(secretArb, { maxLength: 3 });

// ---------------------------------------------------------------------------
// Scam results
// ---------------------------------------------------------------------------

function capCodePoints(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('');
}

/** A Reason: non-empty, normalizeMessage-stable, single line, at most 120 code points. */
export const reasonArb: fc.Arbitrary<string> = fc
  .array(wordArb, { minLength: 1, maxLength: 30 })
  .map((words) =>
    normalizeMessage(capCodePoints(normalizeMessage(words.join(' ')), MAX_REASON_CODE_POINTS)),
  )
  .filter(
    (r) =>
      r.length > 0 &&
      normalizeMessage(r) === r &&
      !/[\n\r]/.test(r) &&
      Array.from(r).length <= MAX_REASON_CODE_POINTS,
  );

export const scamVerdictArb: fc.Arbitrary<ScamVerdict> = fc.constantFrom(...VERDICTS);

/** A valid ScamResult. */
export const scamResultArb: fc.Arbitrary<ScamResult> = fc.record({
  verdict: scamVerdictArb,
  reason: reasonArb,
});

// ---------------------------------------------------------------------------
// Client scripts (Mock_Client steps)
// ---------------------------------------------------------------------------

/** Rejection or throw values that are not AiErrors. */
const foreignValueArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  new Error('boom'),
  new TypeError('fetch failed'),
  'plain string',
  42,
  null,
  undefined,
  { kind: 'quota' },
);

/** Non-string resolution values. */
const nonStringValueArb: fc.Arbitrary<unknown> = fc.constantFrom<unknown>(
  undefined,
  null,
  0,
  true,
  {},
  [],
);

/** A step that resolves with usable (non-blank) model text. */
export const usableTextStepArb: fc.Arbitrary<MockStep> = modelOutputArb
  .filter((t) => t.trim().length > 0)
  .map((text) => ({ text }));

/** A step that fails: AiError of any kind, foreign rejection, throw, non-string, blank, or hang. */
export function failingStep(options: { readonly hang?: boolean } = {}): fc.Arbitrary<MockStep> {
  const steps: fc.Arbitrary<MockStep>[] = [
    aiErrorKindArb.map((kind) => ({ error: new AiError(kind) })),
    foreignValueArb.map((reject) => ({ reject })),
    foreignValueArb.map((throws) => ({ throws })),
    nonStringValueArb.map((value) => ({ value })),
    blankTextArb.map((text) => ({ text })),
  ];
  if (options.hang === true) steps.push(fc.constant({ hang: true as const }));
  return fc.oneof(...steps);
}

/** Any Mock_Client step. `hang` steps are included only when asked (they need fake timers). */
export function clientStep(options: { readonly hang?: boolean } = {}): fc.Arbitrary<MockStep> {
  return fc.oneof(usableTextStepArb, failingStep(options));
}

/** A script of 1 to 4 Mock_Client steps. */
export function clientScript(
  options: { readonly hang?: boolean; readonly maxLength?: number } = {},
): fc.Arbitrary<readonly MockStep[]> {
  return fc.array(clientStep(options), { minLength: 1, maxLength: options.maxLength ?? 4 });
}

// ---------------------------------------------------------------------------
// Phone-like digit runs
// ---------------------------------------------------------------------------

export interface DigitRun {
  /** The run as written, with optional leading `+` and spaces or hyphens between digits. */
  readonly run: string;
  /** The digits only, in order. */
  readonly digits: string;
}

function digitRun(minDigits: number, maxDigits: number, plus: boolean): fc.Arbitrary<DigitRun> {
  return fc
    .tuple(
      fc.boolean(),
      fc.array(
        fc.tuple(
          fc.constantFrom(...DIGITS),
          fc.string({ unit: fc.constantFrom(' ', '-'), maxLength: 2 }),
        ),
        { minLength: minDigits, maxLength: maxDigits },
      ),
    )
    .map(([withPlus, parts]) => {
      const digits = parts.map(([d]) => d).join('');
      const body = parts.map(([d, sep], i) => (i === parts.length - 1 ? d : d + sep)).join('');
      return { run: (plus && withPlus ? '+' : '') + body, digits };
    });
}

/** A phone-like run of 7 to 15 digits with optional `+` and separators. */
export const phoneLikeRunArb: fc.Arbitrary<DigitRun> = digitRun(7, 15, true);

/** A run of 1 to 6 digits with optional separators; it must stay unchanged. */
export const shortDigitRunArb: fc.Arbitrary<DigitRun> = digitRun(1, 6, false);
