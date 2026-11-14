// Property-based tests for the Gemini adapter helpers (`models.ts`, `gemini.entry.ts`).
//
// Runs at least 100 fast-check iterations (PBT_OPTIONS). No network, no process.env.
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { DEFAULT_GEMINI_MODEL, resolveModel } from './models.js';
import { PBT_OPTIONS } from './answer.arbitraries.js';
import { AiError, type Prompt } from './ai.types.js';
import { REDACTED } from './answer.texts.js';
import { createGeminiClient } from './gemini.entry.js';
import { createFakeGenai, type FakeStep } from './gemini.fake.js';

/** A generated model value plus the trimmed value it should resolve to, if any. */
interface ModelInput {
  readonly raw: string | undefined;
  readonly trimmed: string | undefined;
}

const WHITESPACE = [' ', '\t', '\n', '\r', '\u00a0', '\u2003', '\ufeff'] as const;
const whitespaceArb = fc
  .array(fc.constantFrom(...WHITESPACE), { maxLength: 5 })
  .map((chars) => chars.join(''));

// Model-like names: non-empty, no leading or trailing whitespace.
const coreNameArb = fc
  .stringMatching(/^[a-z0-9][a-z0-9.\-/ ]{0,30}$/)
  .filter((s) => s.trim() === s);

const modelInputArb: fc.Arbitrary<ModelInput> = fc.oneof(
  fc.constant<ModelInput>({ raw: undefined, trimmed: undefined }),
  whitespaceArb.map<ModelInput>((ws) => ({ raw: ws, trimmed: undefined })),
  fc
    .tuple(whitespaceArb, coreNameArb, whitespaceArb)
    .map<ModelInput>(([pre, core, post]) => ({ raw: `${pre}${core}${post}`, trimmed: core })),
);

// ---- Property 29 support ----

const LEAK_MODEL = 'gemini-test-model';
const LEAK_PROMPT: Prompt = {
  system: 'Answer briefly and kindly.',
  user: '<<<what is the weather>>>',
};
const ERROR_STATUSES = [undefined, 400, 401, 403, 404, 408, 429, 500, 503, 504] as const;
const ERROR_KINDS = ['quota', 'timeout', 'network', 'unknown'] as const;

/** Every fixed text the adapter can emit or send; a key inside one would appear trivially. */
const FIXED_TEXTS: readonly string[] = [
  LEAK_MODEL,
  LEAK_PROMPT.system,
  LEAK_PROMPT.user,
  REDACTED,
  'gemini: GEMINI_API_KEY is not configured',
  `gemini: request model=${LEAK_MODEL}`,
  'model contents config systemInstruction maxOutputTokens temperature 300 0.3',
  ...ERROR_KINDS.flatMap((kind) =>
    ERROR_STATUSES.map((status) =>
      status === undefined
        ? `gemini: error kind=${kind} Gemini request failed`
        : `gemini: error kind=${kind} Gemini request failed (status ${status})`,
    ),
  ),
];

/** 1 to 100 characters, none of them whitespace, not inside any fixed text. */
const keyArb = fc
  .oneof(
    fc.string({ minLength: 1, maxLength: 100 }),
    fc.string({ minLength: 1, maxLength: 100, unit: 'grapheme' }),
  )
  .filter((key) => key.length <= 100 && !/\s/u.test(key) && key.trim() === key)
  .filter((key) => !FIXED_TEXTS.some((text) => text.includes(key)));

const errorStepArb = (key: string): fc.Arbitrary<FakeStep> =>
  fc
    .record({
      status: fc.constantFrom(...ERROR_STATUSES),
      name: fc.constantFrom(undefined, 'Error', 'ApiError', 'AbortError', 'TypeError'),
      code: fc.constantFrom(undefined, 'ECONNRESET', 'ETIMEDOUT', key),
      pre: fc.constantFrom('', 'API key not valid: ', 'RESOURCE_EXHAUSTED key=', 'bad '),
      post: fc.constantFrom('', ' (check your key)', `?key=${key}`),
    })
    .map(({ status, name, code, pre, post }) => ({
      error: {
        ...(status === undefined ? {} : { status }),
        ...(name === undefined ? {} : { name }),
        ...(code === undefined ? {} : { code }),
        message: `${pre}${key}${post}`,
      },
    }));

const leakCaseArb = keyArb.chain((key) =>
  fc.record({
    key: fc.constant(key),
    pad: fc.constantFrom('', ' ', '\t', '\n '),
    steps: fc.array(fc.oneof(errorStepArb(key), fc.constant<FakeStep>({ text: 'ok' })), {
      minLength: 1,
      maxLength: 4,
    }),
  }),
);

const blankKeyArb = fc.oneof(fc.constant(undefined), whitespaceArb);

/** Every string reachable inside a value, both property names and leaves. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([name, inner]) => [name, ...stringsIn(inner)]);
}

describe('Gemini adapter properties', () => {
  // Feature: ai-answer-service, Property 28: Model resolution precedence
  // **Validates: Requirements 15.2, 15.3, 15.4**
  it('Property 28: option beats GEMINI_MODEL, which beats the default, after trimming', () => {
    fc.assert(
      fc.property(modelInputArb, modelInputArb, (option, env) => {
        const expected = option.trimmed ?? env.trimmed ?? DEFAULT_GEMINI_MODEL;
        expect(resolveModel(option.raw, env.raw)).toBe(expected);
      }),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 29: The Gemini adapter never leaks the key
  // **Validates: Requirements 14.1, 14.3, 14.4, 14.5, 14.6, 13.11, 13.12**
  it('Property 29: the key reaches only the SDK factory, never errors or logs', async () => {
    await fc.assert(
      fc.asyncProperty(leakCaseArb, async ({ key, pad, steps }) => {
        const fake = createFakeGenai(steps);
        const lines: string[] = [];
        const client = createGeminiClient({
          env: { GEMINI_API_KEY: `${pad}${key}${pad}` },
          model: LEAK_MODEL,
          genai: fake.factory,
          log: (line) => lines.push(line),
        });

        const errors: unknown[] = [];
        for (let i = 0; i < steps.length; i += 1) {
          await client.complete(LEAK_PROMPT).catch((error: unknown) => errors.push(error));
        }

        expect(fake.keys).toEqual([key]);
        expect(fake.calls).toHaveLength(steps.length);
        for (const call of fake.calls) {
          for (const text of stringsIn(call)) expect(text).not.toContain(key);
        }
        expect(errors).toHaveLength(steps.filter((step) => 'error' in step).length);
        for (const error of errors) {
          expect(error).toBeInstanceOf(AiError);
          expect((error as AiError).message).not.toContain(key);
        }
        for (const line of lines) expect(line).not.toContain(key);
      }),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 29: The Gemini adapter never leaks the key
  // **Validates: Requirements 14.1, 14.3, 14.4, 14.5, 14.6, 13.11, 13.12**
  it('Property 29: a missing or blank key never builds the SDK and rejects with unknown', async () => {
    await fc.assert(
      fc.asyncProperty(blankKeyArb, fc.integer({ min: 1, max: 3 }), async (blank, attempts) => {
        const fake = createFakeGenai([{ text: 'should not be used' }]);
        const client = createGeminiClient({
          env: blank === undefined ? {} : { GEMINI_API_KEY: blank },
          model: LEAK_MODEL,
          genai: fake.factory,
        });

        for (let i = 0; i < attempts; i += 1) {
          const error: unknown = await client.complete(LEAK_PROMPT).then(
            () => undefined,
            (rejection: unknown) => rejection,
          );
          expect(error).toBeInstanceOf(AiError);
          expect((error as AiError).kind).toBe('unknown');
        }
        expect(fake.keys).toHaveLength(0);
        expect(fake.calls).toHaveLength(0);
      }),
      PBT_OPTIONS,
    );
  });
});
