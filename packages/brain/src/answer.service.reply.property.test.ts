// Property tests for the Answer_Service replies (answerQuestion and checkScam).
// Shared helpers live at the top so later properties can reuse them.
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMockClient, type MockStep } from './ai.mock.js';
import {
  anyInputTextArb,
  blankTextArb,
  clientScript,
  failingStep,
  languageArb,
  liveFactQuestionArb,
  mixedScriptText,
  modelOutputArb,
  PBT_OPTIONS,
  scamVerdictArb,
  topicQuestionArb,
} from './answer.arbitraries.js';
import { createMemoryCache } from './answer.cache.js';
import { answerQuestion, checkScam } from './answer.service.js';
import { FIXED_TEXTS } from './answer.texts.js';
import type { AnswerDeps, Language, ScamVerdict } from './answer.types.js';
import { detectLanguage } from './language.js';
import { MAX_PARTS } from './limits.js';
import { normalizeMessage } from './normalize.js';
import { LANGUAGES } from './router.types.js';
import { joinSms, splitSms } from './sms.js';

/** Small real-timer timeout so `hang` steps settle in a few ms. */
const TEST_TIMEOUT_MS = 2;

type ServiceOp = (deps: AnswerDeps, text: string, language?: Language) => Promise<string>;

interface NamedOp {
  readonly name: 'answerQuestion' | 'checkScam';
  readonly run: ServiceOp;
}

const OPS: readonly NamedOp[] = [
  { name: 'answerQuestion', run: answerQuestion },
  { name: 'checkScam', run: checkScam },
];

const opArb: fc.Arbitrary<NamedOp> = fc.constantFrom(...OPS);

/** Question or scam argument of 0 to 10,000 characters. */
const inputArb: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: anyInputTextArb, weight: 4 },
  { arbitrary: mixedScriptText({ minLength: 1000, maxLength: 10_000 }), weight: 1 },
);

/** A supplied Language or none. */
const optionalLanguageArb: fc.Arbitrary<Language | undefined> = fc.option(languageArb, {
  nil: undefined,
});

/** Fresh deps over a Mock_Client running `script`, an empty cache and a fixed clock. */
function makeDeps(script: readonly MockStep[]): AnswerDeps {
  return {
    client: createMockClient(script),
    cache: createMemoryCache(),
    clock: () => 0,
    timeoutMs: TEST_TIMEOUT_MS,
  };
}

/** Runs the operation and reports whether it resolved or rejected. */
async function settle(
  op: NamedOp,
  deps: AnswerDeps,
  text: string,
  language: Language | undefined,
): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  try {
    return { ok: true, value: await op.run(deps, text, language) };
  } catch {
    return { ok: false };
  }
}

/**
 * Question of 0 to 1,000 characters: free text, or a sensitive-topic or
 * live-fact question (with its keyword-list Language) so suffixes are added.
 */
const smsQuestionArb: fc.Arbitrary<{ readonly text: string; readonly language?: Language }> =
  fc.oneof(
    mixedScriptText({ maxLength: 1000 }).map((text) => ({ text })),
    topicQuestionArb.map((q) => ({ text: q.question, language: q.language })),
    liveFactQuestionArb.map((q) => ({ text: q.question, language: q.language })),
  );

/** How the Language argument is given: valid, missing, or outside LANGUAGES. */
type LanguageChoice =
  | { readonly kind: 'supplied'; readonly language: Language }
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid'; readonly language: Language };

const invalidLanguageArb: fc.Arbitrary<Language> = fc
  .oneof(fc.constantFrom('', 'EN', 'urdu', 'Roman-Ur', 'fr', ' en'), fc.string({ maxLength: 12 }))
  .filter((s) => !(LANGUAGES as readonly string[]).includes(s))
  .map((s) => s as unknown as Language);

const languageChoiceArb: fc.Arbitrary<LanguageChoice> = fc.oneof(
  languageArb.map((language) => ({ kind: 'supplied' as const, language })),
  fc.constant({ kind: 'none' as const }),
  invalidLanguageArb.map((language) => ({ kind: 'invalid' as const, language })),
);

/** The Language the service must choose for `choice` and `text`. */
function expectedLanguage(choice: LanguageChoice, text: string): Language {
  if (choice.kind === 'supplied') return choice.language;
  if (choice.kind === 'invalid') return 'en';
  const detected: unknown = detectLanguage(text);
  return (LANGUAGES as readonly unknown[]).includes(detected) ? (detected as Language) : 'en';
}

function suppliedLanguage(choice: LanguageChoice): Language | undefined {
  return choice.kind === 'none' ? undefined : choice.language;
}

/** A script of 1 to 4 steps that all fail (hangs included). */
const failingScriptArb: fc.Arbitrary<readonly MockStep[]> = fc.array(
  failingStep({ hang: true }),
  { minLength: 1, maxLength: 4 },
);

describe('Answer_Service replies (property tests)', () => {
  // Feature: ai-answer-service, Property 1: The service always replies with non-blank text
  // **Validates: Requirements 2.4, 2.7, 3.9, 8.1, 8.2, 8.3, 12.6, 12.7**
  it('Property 1: always resolves with non-blank text for any input and client behavior', async () => {
    await fc.assert(
      fc.asyncProperty(
        opArb,
        inputArb,
        optionalLanguageArb,
        clientScript({ hang: true }),
        async (op, text, language, script) => {
          const result = await settle(op, makeDeps(script), text, language);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(typeof result.value).toBe('string');
          expect(String(result.value).trim().length).toBeGreaterThan(0);
        },
      ),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 2: Replies fit the SMS budget without truncation
  // **Validates: Requirements 3.3, 3.6, 3.7, 9.4, 13.2**
  it('Property 2: replies split into 1 to MAX_PARTS parts and join back exactly', async () => {
    await fc.assert(
      fc.asyncProperty(
        opArb,
        smsQuestionArb,
        optionalLanguageArb,
        modelOutputArb,
        async (op, question, fallbackLanguage, output) => {
          const language = question.language ?? fallbackLanguage;
          const reply = await op.run(makeDeps([{ text: output }]), question.text, language);
          const parts = splitSms(reply);
          expect(joinSms(parts)).toBe(reply);
          expect(parts.length).toBeGreaterThanOrEqual(1);
          expect(parts.length).toBeLessThanOrEqual(MAX_PARTS);
        },
      ),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 5: Fixed texts follow the Language that was chosen
  // **Validates: Requirements 4.1, 4.3, 4.7**
  it('Property 5: Try_Later_Text uses the supplied, detected or fallback en Language', async () => {
    await fc.assert(
      fc.asyncProperty(
        opArb,
        inputArb.filter((t) => normalizeMessage(t) !== ''),
        languageChoiceArb,
        failingScriptArb,
        async (op, text, choice, script) => {
          const reply = await op.run(makeDeps(script), text, suppliedLanguage(choice));
          expect(reply).toBe(FIXED_TEXTS[expectedLanguage(choice, text)].tryLater);
        },
      ),
      PBT_OPTIONS,
    );
  });

  it('Property 5: blank input gets the prompt text of the chosen Language', async () => {
    await fc.assert(
      fc.asyncProperty(
        opArb,
        blankTextArb,
        languageChoiceArb,
        failingScriptArb,
        async (op, text, choice, script) => {
          const reply = await op.run(makeDeps(script), text, suppliedLanguage(choice));
          const texts = FIXED_TEXTS[expectedLanguage(choice, text)];
          const prompt = op.name === 'answerQuestion' ? texts.promptForQuestion : texts.promptForScamText;
          expect(reply).toBe(prompt);
        },
      ),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 20: Scam replies are one line and keep the verdict word
  // **Validates: Requirements 9.3, 9.4**
  it('Property 20: scam replies are one line, fit SMS and start with the full verdict word', async () => {
    const VERDICT_LIST: readonly ScamVerdict[] = ['SCAM', 'SAFE', 'UNSURE'];
    /** Long, markdown-heavy or multi-line Reason text. */
    const reasonTextArb: fc.Arbitrary<string> = fc.oneof(
      modelOutputArb,
      fc
        .array(fc.constantFrom('**bold**', '- item', '## Title', '`code`', '_soft_', '\n', '\r\n'), {
          maxLength: 40,
        })
        .map((units) => units.join(' ')),
    );
    await fc.assert(
      fc.asyncProperty(
        inputArb.filter((t) => normalizeMessage(t) !== ''),
        languageArb,
        // `VERDICT: <reason>` with a canonical or localized word, or arbitrary model output.
        fc.oneof(
          fc.record({
            verdict: scamVerdictArb,
            localized: fc.boolean(),
            reason: reasonTextArb,
          }),
          modelOutputArb.map((raw) => ({ raw })),
        ),
        async (argument, language, shape) => {
          const output =
            'raw' in shape
              ? shape.raw
              : `${shape.localized ? FIXED_TEXTS[language].scamWord[shape.verdict] : shape.verdict}: ${shape.reason}`;
          const reply = await checkScam(makeDeps([{ text: output }]), argument, language);
          const texts = FIXED_TEXTS[language];
          if (reply === texts.tryLater) return;

          expect(reply).not.toMatch(/[\r\n]/);
          const verdicts = 'raw' in shape ? VERDICT_LIST : [shape.verdict];
          expect(verdicts.some((v) => reply.startsWith(`${texts.scamWord[v]}: `))).toBe(true);
          const parts = splitSms(reply);
          expect(joinSms(parts)).toBe(reply);
          expect(parts.length).toBeLessThanOrEqual(MAX_PARTS);
        },
      ),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 21: Blank input skips the AI
  // **Validates: Requirements 2.3, 9.9**
  it('Property 21: blank input makes zero client calls and returns the prompt text', async () => {
    /** Unicode whitespace that normalizeMessage collapses to nothing. */
    const unicodeBlankArb: fc.Arbitrary<string> = fc
      .string({
        unit: fc.constantFrom(
          ' ', '\t', '\n', '\r', '\v', '\f', '\u00A0', '\u1680', '\u2000', '\u2003',
          '\u2009', '\u200A', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF',
        ),
        maxLength: 12,
      })
      .filter((t) => normalizeMessage(t) === '');
    await fc.assert(
      fc.asyncProperty(
        opArb,
        fc.oneof(blankTextArb, unicodeBlankArb),
        languageChoiceArb,
        clientScript({ hang: true }),
        async (op, text, choice, script) => {
          const client = createMockClient(script);
          const cache = createMemoryCache();
          const deps: AnswerDeps = { client, cache, clock: () => 0, timeoutMs: TEST_TIMEOUT_MS };
          const reply = await op.run(deps, text, suppliedLanguage(choice));
          const texts = FIXED_TEXTS[expectedLanguage(choice, text)];
          const prompt = op.name === 'answerQuestion' ? texts.promptForQuestion : texts.promptForScamText;
          expect(reply).toBe(prompt);
          expect(client.calls).toHaveLength(0);
          expect(cache.size()).toBe(0);
        },
      ),
      PBT_OPTIONS,
    );
  });
});
