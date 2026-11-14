import type { AiClient, AiError, Prompt } from './ai.types.js';

export type MockStep =
  | { readonly text: string }
  | { readonly error: AiError }
  | { readonly reject: unknown } // non-AiError rejection
  | { readonly throws: unknown } // synchronous throw
  | { readonly value: unknown } // resolves with a non-string
  | { readonly hang: true }; // never settles

export interface MockClient extends AiClient {
  readonly calls: readonly Prompt[];
}

/** Steps are consumed in order; the last step repeats. Reads no env, makes no network call. */
export function createMockClient(steps: readonly MockStep[]): MockClient {
  const calls: Prompt[] = [];
  let index = 0;

  return {
    calls,
    complete(prompt: Prompt): Promise<string> {
      calls.push(prompt);
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if (step === undefined) {
        return Promise.resolve('');
      }
      if ('text' in step) return Promise.resolve(step.text);
      if ('error' in step) return Promise.reject(step.error);
      if ('reject' in step) return Promise.reject(step.reject);
      if ('throws' in step) throw step.throws;
      if ('value' in step) return Promise.resolve(step.value as string);
      return new Promise<string>(() => undefined);
    },
  };
}
