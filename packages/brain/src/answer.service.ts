/**
 * Answer_Service orchestration: the only impure layer around the AI call.
 * Uses the injected client, cache and clock; never reads env, never logs,
 * never rejects. Pure helpers do the text work.
 * _Requirements: 1.1, 1.4, 2.1-2.4, 2.7, 3.3, 3.5, 3.9, 4.1, 4.3, 4.7, 5.3, 5.4,
 * 5.6, 5.7, 5.8, 6.2, 6.3, 6.6, 7.2-7.4, 7.6, 8.1, 8.2, 8.9, 9.1, 9.3-9.5, 9.9-9.11,
 * 10.1, 10.4, 11.4, 12.6_
 */
import type { Prompt } from './ai.types.js';
import { callWithPolicy } from './answer.call.js';
import type { CallOutcome } from './answer.call.js';
import { buildCacheKey } from './answer.key.js';
import { buildPrompt } from './answer.prompt.js';
import { redactSecrets } from './answer.redact.js';
import { parseScam, printScam } from './answer.scam.js';
import { hasPromptLeak, joinReply, removeAll, shortenToFit, stripMarkdown } from './answer.text.js';
import {
  CACHE_TTL_MS,
  CALL_TIMEOUT_MS,
  FIXED_TEXTS,
  MAX_QUESTION_CODE_POINTS,
} from './answer.texts.js';
import {
  asksForLiveFacts,
  asksForPriceOrRate,
  classifyTopic,
  containsUnsupportedAmount,
} from './answer.topic.js';
import type { AnswerDeps, Language, Topic } from './answer.types.js';
import { detectLanguage } from './language.js';
import { normalizeMessage } from './normalize.js';
import { LANGUAGES } from './router.types.js';

function isLanguage(value: unknown): value is Language {
  return (LANGUAGES as readonly unknown[]).includes(value);
}

/**
 * Supplied valid Language is used as is; a supplied invalid value gives `en`;
 * no value gives exactly one `detectLanguage` call (outside LANGUAGES gives `en`).
 */
export function resolveLanguage(supplied: Language | undefined, text: string): Language {
  if (supplied !== undefined) {
    return isLanguage(supplied) ? supplied : 'en';
  }
  const detected: unknown = detectLanguage(text);
  return isLanguage(detected) ? detected : 'en';
}

/** First `max` code points of `text`; never splits a surrogate pair. */
function firstCodePoints(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('');
}

/** Cache read; a throwing cache or clock counts as a miss. */
function readCache(deps: AnswerDeps, key: string): string | undefined {
  try {
    const hit = deps.cache.get(key, deps.clock());
    return typeof hit === 'string' && hit.trim() !== '' ? hit : undefined;
  } catch {
    return undefined;
  }
}

/** Cache write with a 24 h TTL from now; failures are ignored. */
function writeCache(deps: AnswerDeps, key: string, reply: string): void {
  try {
    deps.cache.set(key, reply, deps.clock() + CACHE_TTL_MS);
  } catch {
    // A failing cache must not change the reply.
  }
}

/**
 * Reply for a failed call: on `quota` the cache is re-checked exactly once
 * (Requirement 8.9); otherwise, or on a miss, the Try_Later_Text.
 */
function failureReply(
  deps: AnswerDeps,
  key: string,
  language: Language,
  outcome: Extract<CallOutcome, { ok: false }>,
): string {
  const tryLater = FIXED_TEXTS[language].tryLater;
  if (outcome.error.kind !== 'quota') return tryLater;
  return readCache(deps, key) ?? tryLater;
}

/**
 * Shared first stage of post-processing: redact secrets, reject prompt
 * leaks, strip markdown, reject blank text. Returns null when rejected.
 */
function cleanModelText(deps: AnswerDeps, modelText: string, prompt: Prompt): string | null {
  const redacted = redactSecrets(modelText, deps.secrets ?? []);
  if (hasPromptLeak(redacted, prompt.system)) return null;
  const stripped = stripMarkdown(redacted);
  return stripped === '' ? null : stripped;
}

/**
 * Removes every needle and normalizes, repeating until no needle is present.
 * Normalizing can re-form a needle (e.g. a nested copy whose removal leaves
 * a double space), so removal and normalization loop together. Each pass
 * that finds a needle strictly shortens the text, so the loop is bounded.
 */
function removeFixedSentences(text: string, needles: readonly string[]): string {
  const active = needles.filter((needle) => needle !== '');
  let current = normalizeMessage(text);
  for (let pass = 0; pass <= text.length; pass += 1) {
    if (!active.some((needle) => current.includes(needle))) return current;
    current = normalizeMessage(active.reduce((acc, needle) => removeAll(acc, needle), current));
  }
  return current;
}

interface QuestionContext {
  readonly language: Language;
  readonly question: string;
  readonly topic: Topic | null;
  readonly liveFacts: boolean;
  readonly priceOrRate: boolean;
}

/**
 * Question-specific post-processing: price guard, de-duplication of fixed
 * sentences, suffix rebuild (referral then note, each once) and shortening
 * of the model text only. Returns null when nothing usable remains.
 */
function buildQuestionReply(clean: string, ctx: QuestionContext): string | null {
  const texts = FIXED_TEXTS[ctx.language];
  const replaced = ctx.priceOrRate && containsUnsupportedAmount(clean, ctx.question);
  const needles =
    ctx.topic === null ? [texts.uncertainty] : [texts.referral[ctx.topic], texts.uncertainty];
  const model = removeFixedSentences(replaced ? texts.uncertainty : clean, needles);
  const parts: string[] = [];
  if (ctx.topic !== null) parts.push(texts.referral[ctx.topic]);
  if (ctx.liveFacts || replaced) parts.push(texts.uncertainty);
  const suffix = parts.join(' ');
  const reply = joinReply(shortenToFit(model, suffix), suffix);
  return reply.trim() === '' ? null : reply;
}

async function answerQuestionUnsafe(
  deps: AnswerDeps,
  question: string,
  language: Language,
): Promise<string> {
  const texts = FIXED_TEXTS[language];
  const norm = normalizeMessage(question);
  if (norm === '') return texts.promptForQuestion;
  const text = firstCodePoints(norm, MAX_QUESTION_CODE_POINTS);
  const key = buildCacheKey('question', language, text);
  const cached = readCache(deps, key);
  if (cached !== undefined) return cached;

  const { topic } = classifyTopic(text, language);
  const ctx: QuestionContext = {
    language,
    question: text,
    topic,
    liveFacts: asksForLiveFacts(text, language),
    priceOrRate: asksForPriceOrRate(text, language),
  };
  const prompt = buildPrompt(text, { kind: 'question', language, topic, liveFacts: ctx.liveFacts });
  const outcome = await callWithPolicy(deps.client, prompt, deps.timeoutMs ?? CALL_TIMEOUT_MS);
  if (!outcome.ok) return failureReply(deps, key, language, outcome);

  const clean = cleanModelText(deps, outcome.text, prompt);
  const reply = clean === null ? null : buildQuestionReply(clean, ctx);
  if (reply === null) return texts.tryLater;
  writeCache(deps, key, reply);
  return reply;
}

/**
 * Scam-specific post-processing: parse, drop model copies of the money
 * referral, append it once only for a `money` topic with verdict `UNSURE`,
 * and shorten only the Reason against the fixed `verdict: ` prefix and the
 * suffix. A Reason that shrinks to empty falls back to the fixed Reason.
 */
function buildScamReply(clean: string, language: Language, topic: Topic | null): string {
  const texts = FIXED_TEXTS[language];
  const { verdict, reason: parsedReason } = parseScam(clean, language);
  const moneyReferral = texts.referral.money;
  const reason =
    topic === 'money' ? removeFixedSentences(parsedReason, [moneyReferral]) : parsedReason;
  const suffix = topic === 'money' && verdict === 'UNSURE' ? moneyReferral : '';
  const prefix = `${texts.scamWord[verdict]}: `;
  const shortened = reason === '' ? '' : shortenToFit(reason, suffix, prefix);
  const finalReason = shortened === '' ? texts.scamReason[verdict] : shortened;
  return joinReply(printScam({ verdict, reason: finalReason }, language), suffix);
}

async function checkScamUnsafe(
  deps: AnswerDeps,
  argument: string,
  language: Language,
): Promise<string> {
  const texts = FIXED_TEXTS[language];
  const norm = normalizeMessage(argument);
  if (norm === '') return texts.promptForScamText;
  const text = firstCodePoints(norm, MAX_QUESTION_CODE_POINTS);
  const key = buildCacheKey('scam', language, text);
  const cached = readCache(deps, key);
  if (cached !== undefined) return cached;

  const { topic } = classifyTopic(text, language);
  const prompt = buildPrompt(text, { kind: 'scam', language, topic, liveFacts: false });
  const outcome = await callWithPolicy(deps.client, prompt, deps.timeoutMs ?? CALL_TIMEOUT_MS);
  if (!outcome.ok) return failureReply(deps, key, language, outcome);

  const clean = cleanModelText(deps, outcome.text, prompt);
  if (clean === null) return texts.tryLater;
  const reply = buildScamReply(clean, language, topic);
  if (reply.trim() === '' || /[\r\n]/.test(reply)) return texts.tryLater;
  writeCache(deps, key, reply);
  return reply;
}

/**
 * Checks a forwarded message for a scam. Never rejects: any unexpected
 * failure gives the Try_Later_Text in the best-known Language.
 */
export async function checkScam(
  deps: AnswerDeps,
  argument: string,
  language?: Language,
): Promise<string> {
  let lang: Language = 'en';
  try {
    lang = resolveLanguage(language, argument);
    return await checkScamUnsafe(deps, argument, lang);
  } catch {
    return FIXED_TEXTS[lang].tryLater;
  }
}

/**
 * Answers a free question. Never rejects: any unexpected failure gives the
 * Try_Later_Text in the best-known Language.
 */
export async function answerQuestion(
  deps: AnswerDeps,
  question: string,
  language?: Language,
): Promise<string> {
  let lang: Language = 'en';
  try {
    lang = resolveLanguage(language, question);
    return await answerQuestionUnsafe(deps, question, lang);
  } catch {
    return FIXED_TEXTS[lang].tryLater;
  }
}
