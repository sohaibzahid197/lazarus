/**
 * Fake_Genai_SDK: test support for the Gemini adapter.
 *
 * Same shape as the used part of `@google/genai` (a factory that receives the
 * API key and a `models.generateContent` method). It records every key and
 * every `generateContent` argument and never touches the network. Only a
 * type is imported from the adapter, so the SDK is never loaded.
 */
import type { GenaiLike } from './gemini.entry.js';

export type GenerateParams = Parameters<GenaiLike['models']['generateContent']>[0];

/** Fields of the scripted SDK error; each is set only when given. */
export interface FakeErrorFields {
  readonly status?: unknown;
  readonly name?: string;
  readonly code?: unknown;
  readonly message?: string;
}

export type FakeStep =
  | { readonly text: string }
  | { readonly response: { readonly text?: unknown } }
  | { readonly error: FakeErrorFields };

export interface FakeGenai {
  /** Pass as `GeminiOptions.genai`. */
  readonly factory: (apiKey: string) => GenaiLike;
  /** Every key the factory received, in order. */
  readonly keys: readonly string[];
  /** Every `generateContent` argument, in order. */
  readonly calls: readonly GenerateParams[];
}

/** Builds an Error carrying the scripted fields, like the SDK's ApiError. */
export function makeFakeError(fields: FakeErrorFields): Error {
  const error = new Error(fields.message ?? '');
  if (fields.name !== undefined) error.name = fields.name;
  if ('status' in fields) Object.assign(error, { status: fields.status });
  if ('code' in fields) Object.assign(error, { code: fields.code });
  return error;
}

function runStep(step: FakeStep): Promise<{ readonly text?: string }> {
  if ('error' in step) return Promise.reject(makeFakeError(step.error));
  if ('text' in step) return Promise.resolve({ text: step.text });
  // A non-string text is allowed on purpose, to test the adapter's fallback.
  return Promise.resolve(step.response as { readonly text?: string });
}

/**
 * Steps are consumed in order, one per `generateContent` call; the last step
 * repeats. With no steps every call resolves to `{ text: '' }`.
 */
export function createFakeGenai(steps: readonly FakeStep[] = []): FakeGenai {
  const keys: string[] = [];
  const calls: GenerateParams[] = [];
  const fallback: FakeStep = { text: '' };

  const nextStep = (): FakeStep => {
    const index = Math.min(calls.length - 1, steps.length - 1);
    return steps[index] ?? fallback;
  };

  const factory = (apiKey: string): GenaiLike => {
    keys.push(apiKey);
    return {
      models: {
        generateContent(params: GenerateParams): Promise<{ readonly text?: string }> {
          calls.push(params);
          return runStep(nextStep());
        },
      },
    };
  };

  return { factory, keys, calls };
}
