// Safety properties of the Answer_Service: professional referrals, sensitive
// failures, scam money referral, uncertainty note, prompt leaks and secrets.
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMockClient } from './ai.mock.js';
import type { MockClient, MockStep } from './ai.mock.js';
import { AiError } from './ai.types.js';
import type { AiClient } from './ai.types.js';
import {
  PBT_OPTIONS,
  aiErrorKindArb,
  failingStep,
  keywordQuestion,
  languageArb,
  liveFactQuestionArb,
  mixedScriptText,
  modelOutputArb,
  scamVerdictArb,
  secretArb,
  topicQuestionArb,
} from './answer.arbitraries.js';
import { createMemoryCache } from './answer.cache.js';
import { buildCacheKey } from './answer.key.js';
import { buildPrompt } from './answer.prompt.js';
import { answerQuestion, checkScam } from './answer.service.js';
import { FIXED_TEXTS, PRICE_KEYWORDS, REDACTED, TOPIC_KEYWORDS } from './answer.texts.js';
import {
  asksForLiveFacts,
  asksForPriceOrRate,
  classifyTopic,
  containsUnsupportedAmount,
} from './answer.topic.js';
import type { AnswerCache, AnswerDeps, Language, ScamVerdict, Topic } from './answer.types.js';
import { normalizeMessage } from './normalize.js';
import { LANGUAGES } from './router.types.js';

/** Shortest copied run of the system instruction that counts as a leak (Requirement 11.4). */
const LEAK_MIN = 40;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface TestDeps {
  readonly deps: AnswerDeps;
  readonly client: MockClient;
}

/** Fresh deps per run: Mock_Client with the given steps, empty memory cache, fixed clock. */
function makeDeps(steps: readonly MockStep[], secrets?: readonly string[]): TestDeps {
  const client = createMockClient(steps);
  const deps: AnswerDeps = {
    client,
    cache: createMemoryCache(),
    clock: () => 0,
    ...(secrets === undefined ? {} : { secrets }),
  };
  return { deps, client };
}

/** Non-overlapping occurrences of `needle` in `text` (`needle` must be non-empty). */
function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Word-boundary splits of a fixed sentence: each [prefix, suffix] pair. */
function splitsOf(sentence: string): (readonly [string, string])[] {
  const words = sentence.split(' ');
  const splits: (readonly [string, string])[] = [];
  for (let i = 1; i < words.length; i += 1) {
    splits.push([words.slice(0, i).join(' '), words.slice(i).join(' ')] as const);
  }
  return splits;
}

const separatorArb: fc.Arbitrary<string> = fc.constantFrom(' ', '  ', '\n', '\n\n', ' \t ');

/**
 * One copy of `sentence`: either alone, or nested between a complementary
 * prefix and suffix of itself (so removing the copy can rebuild another).
 */
function copyArb(sentence: string): fc.Arbitrary<string> {
  const splits = splitsOf(sentence);
  const plain = fc.constant(sentence);
  if (splits.length === 0) return plain;
  const nested = fc
    .tuple(fc.constantFrom(...splits), separatorArb, separatorArb)
    .map(([[pre, post], s1, s2]) => pre + s1 + sentence + s2 + post);
  return fc.oneof(plain, nested);
}

/**
 * Model output that holds `copies` copies of `sentence` (plain or nested),
 * mixed with model text, joined by whitespace runs.
 */
function outputWithCopies(sentence: string, copies: number): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.array(mixedScriptText({ maxLength: 60 }), { minLength: copies + 1, maxLength: copies + 1 }),
      fc.array(copyArb(sentence), { minLength: copies, maxLength: copies }),
      fc.array(separatorArb, { minLength: 2 * copies + 1, maxLength: 2 * copies + 1 }),
      modelOutputArb,
    )
    .map(([texts, copyTexts, seps, tail]) => {
      // Interleave: text, copy, text, copy, ..., text, then the tail.
      const pieces = texts.flatMap((t, i) => {
        const copy = copyTexts[i];
        return copy === undefined ? [t] : [t, copy];
      });
      return pieces.map((p, i) => (i === 0 ? p : (seps[i - 1] ?? ' ') + p)).join('') + ' ' + tail;
    });
}

/**
 * A verdict word for scam model output: the canonical token or the localized
 * word for `verdict`, or (when `unknown`) a word that is no verdict at all.
 */
function verdictWordArb(
  language: Language,
  verdict: ScamVerdict,
  unknown: boolean,
): fc.Arbitrary<string> {
  if (unknown) return fc.constantFrom('MAYBE', 'Perhaps', 'hmm');
  return fc.constantFrom(verdict, FIXED_TEXTS[language].scamWord[verdict]);
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('answer service safety properties', () => {
  // Feature: ai-answer-service, Property 6: Sensitive questions contain the referral exactly once
  // **Validates: Requirements 5.3, 5.4, 13.5**
  it('Property 6: sensitive questions contain the referral exactly once', async () => {
    const caseArb = topicQuestionArb.chain((q) =>
      fc
        .integer({ min: 0, max: 4 })
        .chain((copies) =>
          outputWithCopies(FIXED_TEXTS[q.language].referral[q.topic], copies).map((output) => ({
            q,
            copies,
            output,
          })),
        ),
    );
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ q, copies, output }) => {
        const texts = FIXED_TEXTS[q.language];
        const referral = texts.referral[q.topic];
        const { deps, client } = makeDeps([{ text: output }]);
        const reply = await answerQuestion(deps, q.question, q.language);
        expect(client.calls).toHaveLength(1);
        if (reply === texts.tryLater) {
          // Only model text that is blank after cleaning may give Try_Later.
          expect(copies).toBe(0);
          return;
        }
        expect(countOccurrences(reply, referral)).toBe(1);
      }),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 7: Sensitive questions never show model text when the AI fails
  // **Validates: Requirements 5.6**
  it('Property 7: sensitive questions never show model text when the AI fails', async () => {
    // One failing step; the Mock_Client repeats the last step, so every call fails.
    const caseArb = fc.record({ q: topicQuestionArb, step: failingStep({ hang: true }) });
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ q, step }) => {
        const { deps } = makeDeps([step]);
        // Real timers: a hanging step times out after a few ms.
        const reply = await answerQuestion({ ...deps, timeoutMs: 3 }, q.question, q.language);
        expect(reply).toBe(FIXED_TEXTS[q.language].tryLater);
      }),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 9: Scam money referral appears only for UNSURE
  // **Validates: Requirements 5.7, 5.8**
  it('Property 9: scam money referral appears only for UNSURE', async () => {
    const caseArb = fc.record({
      money: fc.boolean(),
      language: languageArb,
      verdict: scamVerdictArb,
      unknownWord: fc.boolean(),
      copies: fc.integer({ min: 0, max: 3 }),
    }).chain((c) =>
      fc.record({
        c: fc.constant(c),
        arg: c.money
          ? keywordQuestion(TOPIC_KEYWORDS[c.language].money).map((q) => q.question)
          : fc
              .constantFrom('health' as const, 'legal' as const)
              .chain((t) => keywordQuestion(TOPIC_KEYWORDS[c.language][t]))
              .map((q) => q.question),
        word: verdictWordArb(c.language, c.verdict, c.unknownWord),
        // Non-money arguments keep model text as is, so the model never copies the referral there.
        reason: outputWithCopies(FIXED_TEXTS[c.language].referral.money, c.money ? c.copies : 0).map(
          (s) => s.replace(/[\r\n]/g, ' '),
        ),
      }),
    );
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ c, arg, word, reason }) => {
        const topic = classifyTopic(arg, c.language).topic;
        fc.pre(c.money ? topic === 'money' : topic !== 'money');
        const expected: ScamVerdict = c.unknownWord ? 'UNSURE' : c.verdict;
        if (!c.money) fc.pre(expected !== 'UNSURE');
        const texts = FIXED_TEXTS[c.language];
        const referral = texts.referral.money;
        const { deps, client } = makeDeps([{ text: `${word}: ${reason}` }]);
        const reply = await checkScam(deps, arg, c.language);
        expect(client.calls).toHaveLength(1);
        expect(/[\r\n]/.test(reply)).toBe(false);
        expect(reply.startsWith(`${texts.scamWord[expected]}: `)).toBe(true);
        if (c.money && expected === 'UNSURE') {
          expect(countOccurrences(reply, referral)).toBe(1);
          expect(reply.endsWith(` ${referral}`)).toBe(true);
        } else {
          expect(countOccurrences(reply, referral)).toBe(0);
        }
      }),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 10: Live-fact questions carry the Uncertainty_Note exactly once, and invented amounts are dropped
  // **Validates: Requirements 6.2, 6.3, 6.6**
  it('Property 10: live-fact questions carry the note exactly once', async () => {
    const caseArb = liveFactQuestionArb.chain((q) =>
      fc
        .integer({ min: 0, max: 4 })
        .chain((copies) =>
          outputWithCopies(FIXED_TEXTS[q.language].uncertainty, copies).map((output) => ({
            q,
            copies,
            output,
          })),
        ),
    );
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ q, copies, output }) => {
        fc.pre(asksForLiveFacts(q.question, q.language));
        const texts = FIXED_TEXTS[q.language];
        const { deps, client } = makeDeps([{ text: output }]);
        const reply = await answerQuestion(deps, q.question, q.language);
        expect(client.calls).toHaveLength(1);
        if (reply === texts.tryLater) {
          // Only model text that is blank after cleaning may give Try_Later.
          expect(copies).toBe(0);
          return;
        }
        expect(countOccurrences(reply, texts.uncertainty)).toBe(1);
      }),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 10: Live-fact questions carry the Uncertainty_Note exactly once, and invented amounts are dropped
  // **Validates: Requirements 6.2, 6.3, 6.6**
  it('Property 10: invented amounts in price answers are dropped', async () => {
    const amountArb = fc
      .tuple(
        fc.integer({ min: 1, max: 99999 }),
        fc.constantFrom('Rs ', 'Rs.', 'PKR ', '$', '', ''),
        fc.constantFrom('', '%'),
      )
      .map(([n, before, after]) => ({
        digits: String(n),
        text: `${before}${String(n)}${before === '' && after === '' ? '%' : after}`,
      }));
    const sensitiveArb = fc.option(fc.constantFrom('health' as const, 'legal' as const, 'money' as const), {
      nil: null,
    });
    const caseArb = fc.tuple(languageArb, sensitiveArb).chain(([language, sensitive]) =>
      fc.record({
        language: fc.constant(language),
        sensitive: fc.constant(sensitive),
        priceQuestion: keywordQuestion(PRICE_KEYWORDS[language]).map((q) => q.question),
        // Optional sensitive keyword so the referral path is exercised too.
        topicPart:
          sensitive === null
            ? fc.constant('')
            : keywordQuestion(TOPIC_KEYWORDS[language][sensitive]).map((q) => q.question),
        // Model text may already hold copies of the note and the referral (plain or nested).
        noteCopy: fc.option(copyArb(FIXED_TEXTS[language].uncertainty), { nil: '' }),
        referralCopy:
          sensitive === null
            ? fc.constant('')
            : fc.option(copyArb(FIXED_TEXTS[language].referral[sensitive]), { nil: '' }),
        before: mixedScriptText({ maxLength: 60 }),
        amount: amountArb,
        after: mixedScriptText({ maxLength: 60 }),
      }),
    );
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const { language, sensitive, amount } = c;
        const question = c.topicPart === '' ? c.priceQuestion : `${c.priceQuestion} ${c.topicPart}`;
        const output = `${c.before} ${c.noteCopy} ${amount.text} ${c.referralCopy} ${c.after}`;
        fc.pre(!/\d/.test(question));
        fc.pre(asksForPriceOrRate(question, language));
        fc.pre(containsUnsupportedAmount(output, question));
        const texts = FIXED_TEXTS[language];
        const { topic } = classifyTopic(question, language);
        if (sensitive !== null) expect(topic).not.toBeNull();
        const { deps, client } = makeDeps([{ text: output }]);
        const reply = await answerQuestion(deps, question, language);
        expect(client.calls).toHaveLength(1);
        // The model text is replaced: the reply is the referral (if sensitive) and the note.
        const expected = topic === null ? texts.uncertainty : `${texts.referral[topic]} ${texts.uncertainty}`;
        expect(reply).toBe(expected);
        expect(reply.includes(amount.digits)).toBe(false);
        expect(countOccurrences(reply, texts.uncertainty)).toBe(1);
        if (topic !== null) expect(countOccurrences(reply, texts.referral[topic])).toBe(1);
      }),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 17: Error details never reach the reply
  // **Validates: Requirements 8.10, 10.1**
  it('Property 17: error details never reach the reply', async () => {
    /** A failing step whose error text holds the secret. */
    const leakyStepArb = (secret: string): fc.Arbitrary<MockStep> =>
      fc
        .tuple(mixedScriptText({ maxLength: 20 }), mixedScriptText({ maxLength: 20 }))
        .map(([before, after]) => `${before}${secret}${after}`)
        .chain((message) =>
          fc.oneof(
            aiErrorKindArb.map((kind): MockStep => ({ error: new AiError(kind, message) })),
            fc.constantFrom<MockStep>(
              { reject: new Error(message) },
              { reject: message },
              { reject: { message, detail: message } },
              { throws: new Error(message) },
              { throws: message },
              { throws: { message } },
            ),
          ),
        );
    const caseArb = fc
      .record({
        language: languageArb,
        scam: fc.boolean(),
        arg: mixedScriptText({ maxLength: 60 }).filter((s) => /[A-Za-z0-9\u0600-\u06FF]/.test(s)),
        secret: secretArb,
        passSecret: fc.boolean(),
      })
      .filter((c) => !FIXED_TEXTS[c.language].tryLater.includes(c.secret))
      .chain((c) => leakyStepArb(c.secret).map((step) => ({ ...c, step })));
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ language, scam, arg, secret, passSecret, step }) => {
        const { deps } = makeDeps([step], passSecret ? [secret] : undefined);
        const run = { ...deps, timeoutMs: 5 };
        const reply = scam ? await checkScam(run, arg, language) : await answerQuestion(run, arg, language);
        expect(reply).toBe(FIXED_TEXTS[language].tryLater);
        expect(reply.includes(secret)).toBe(false);
      }),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 24: Echoed system instructions are discarded
  // **Validates: Requirements 11.4**
  it('Property 24: echoed system instructions are discarded', async () => {
    const caseArb = fc.record({
      language: languageArb,
      scam: fc.boolean(),
      arg: mixedScriptText({ maxLength: 60 }).filter((s) => /[A-Za-z0-9\u0600-\u06FF]/.test(s)),
      // Slice of prompt.system: start and extra length are reduced modulo the real length.
      startSeed: fc.nat(),
      extraSeed: fc.nat(),
      before: mixedScriptText({ maxLength: 60 }),
      after: mixedScriptText({ maxLength: 60 }),
      markdown: fc.constantFrom(['', ''], ['**', '**'], ['_', '_'], ['`', '`'], ['# ', ''], ['- ', '']),
      scamPrefix: fc.boolean(),
    });
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const systems: string[] = [];
        const client: AiClient = {
          complete: (prompt) => {
            const { system } = prompt;
            systems.push(system);
            const start = c.startSeed % (system.length - LEAK_MIN + 1);
            const length = LEAK_MIN + (c.extraSeed % (system.length - start - LEAK_MIN + 1));
            const [open, close] = c.markdown;
            const slice = `${open}${system.slice(start, start + length)}${close}`;
            const lead = c.scam && c.scamPrefix ? 'SCAM: ' : '';
            return Promise.resolve(`${lead}${c.before} ${slice} ${c.after}`);
          },
        };
        const cache = createMemoryCache();
        let writes = 0;
        const countingCache: AnswerCache = {
          get: (key, now) => cache.get(key, now),
          set: (key, value, expiresAt) => {
            writes += 1;
            cache.set(key, value, expiresAt);
          },
          size: () => cache.size(),
        };
        const deps: AnswerDeps = { client, cache: countingCache, clock: () => 0 };
        const reply = c.scam
          ? await checkScam(deps, c.arg, c.language)
          : await answerQuestion(deps, c.arg, c.language);
        expect(systems).toHaveLength(1);
        expect(systems[0]?.length ?? 0).toBeGreaterThanOrEqual(LEAK_MIN);
        expect(reply).toBe(FIXED_TEXTS[c.language].tryLater);
        expect(cache.size()).toBe(0);
        expect(writes).toBe(0);
      }),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 25: Redaction removes every secret
  // **Validates: Requirements 10.1, 10.4**
  it('Property 25: replies, prompts, cache keys and cached values hold no secret', async () => {
    /** Every fixed string the service may emit or send, which a secret could match by chance. */
    const fixedStrings: readonly string[] = [
      REDACTED,
      ...Object.values(FIXED_TEXTS).flatMap((t) => [
        t.tryLater,
        t.promptForQuestion,
        t.promptForScamText,
        t.uncertainty,
        ...Object.values(t.referral),
        ...Object.values(t.scamWord),
        ...Object.values(t.scamReason),
      ]),
      ...LANGUAGES.flatMap((language) =>
        (['question', 'scam'] as const).flatMap((kind) =>
          [null, ...(['health', 'legal', 'money'] as const satisfies readonly Topic[])].flatMap((topic) =>
            [false, true].map((liveFacts) => buildPrompt('', { kind, language, topic, liveFacts }).system),
          ),
        ),
      ),
    ];
    /** Model output: text pieces with each secret inserted 1 to 3 times, in shuffled order. */
    const outputArb = (secrets: readonly string[]): fc.Arbitrary<string> =>
      fc
        .tuple(...secrets.map((s) => fc.integer({ min: 1, max: 3 }).map((n) => Array<string>(n).fill(s))))
        .map((groups) => groups.flat())
        .chain((inserts) =>
          fc.tuple(
            fc.shuffledSubarray(inserts, { minLength: inserts.length, maxLength: inserts.length }),
            fc.array(mixedScriptText({ maxLength: 40 }), {
              minLength: inserts.length + 1,
              maxLength: inserts.length + 1,
            }),
          ),
        )
        .map(([ordered, texts]) => texts.map((t, i) => t + (ordered[i] ?? '')).join(''));
    const caseArb = fc
      .record({
        language: languageArb,
        scam: fc.boolean(),
        arg: mixedScriptText({ maxLength: 60 }).filter((s) => /[A-Za-z0-9\u0600-\u06FF]/.test(s)),
        secrets: fc.array(secretArb, { minLength: 1, maxLength: 3 }),
        verdictShape: fc.boolean(),
        verdict: scamVerdictArb,
      })
      .chain((c) =>
        fc
          .tuple(outputArb(c.secrets), verdictWordArb(c.language, c.verdict, false))
          .map(([body, word]) => ({
            ...c,
            output: c.scam && c.verdictShape ? `${word}: ${body}` : body,
          })),
      );
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        // Only secrets that cannot match fixed text by chance are checked.
        const checked = c.secrets.filter((s) => !fixedStrings.some((f) => f.includes(s)));
        fc.pre(checked.length > 0);
        const kind = c.scam ? 'scam' : 'question';
        // The sender's own text (and so the user prompt and key) must not hold a secret.
        const norm = normalizeMessage(c.arg);
        const expectedUser = buildPrompt(norm, { kind, language: c.language, topic: null, liveFacts: false }).user;
        const expectedKey = buildCacheKey(kind, c.language, norm);
        fc.pre(!checked.some((s) => c.arg.includes(s) || expectedUser.includes(s) || expectedKey.includes(s)));

        const { deps: base, client } = makeDeps([{ text: c.output }], c.secrets);
        const keys: string[] = [];
        const values: string[] = [];
        const recording: AnswerCache = {
          get: (key, now) => {
            keys.push(key);
            return base.cache.get(key, now);
          },
          set: (key, value, expiresAt) => {
            keys.push(key);
            values.push(value);
            base.cache.set(key, value, expiresAt);
          },
          size: () => base.cache.size(),
        };
        const deps: AnswerDeps = { ...base, cache: recording };
        const reply = c.scam
          ? await checkScam(deps, c.arg, c.language)
          : await answerQuestion(deps, c.arg, c.language);

        expect(client.calls.length).toBeGreaterThan(0);
        const prompts = client.calls.flatMap((p) => [p.system, p.user]);
        for (const secret of checked) {
          expect(reply.includes(secret)).toBe(false);
          for (const text of [...prompts, ...keys, ...values]) {
            expect(text.includes(secret)).toBe(false);
          }
        }
      }),
      PBT_OPTIONS,
    );
  });
});
