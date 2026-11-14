/**
 * Call policy: one AI_Client attempt raced against a timer, with at most one
 * retry for `timeout` and `network`. `quota` and `unknown` are never retried.
 * Worst case with a hanging client is 2 x timeoutMs. Never rejects.
 */
import { AiError, toAiError } from './ai.types.js';
import type { AiClient, AiErrorKind, Prompt } from './ai.types.js';

export type CallOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: AiError };

const MAX_CALLS = 2;
const RETRYABLE: ReadonlySet<AiErrorKind> = new Set<AiErrorKind>(['timeout', 'network']);

function success(value: unknown): CallOutcome {
  return { ok: true, text: typeof value === 'string' ? value : '' };
}

function failure(value: unknown): CallOutcome {
  return { ok: false, error: toAiError(value) };
}

function startCall(client: AiClient, prompt: Prompt): Promise<CallOutcome> {
  try {
    return Promise.resolve(client.complete(prompt)).then(success, failure);
  } catch (thrown: unknown) {
    return Promise.resolve(failure(thrown));
  }
}

/** One attempt. A result that arrives after the timer fires is ignored. */
function attempt(client: AiClient, prompt: Prompt, timeoutMs: number): Promise<CallOutcome> {
  return new Promise<CallOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: CallOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, error: new AiError('timeout') });
    }, timeoutMs);
    void startCall(client, prompt).then(finish);
  });
}

export async function callWithPolicy(
  client: AiClient,
  prompt: Prompt,
  timeoutMs: number,
): Promise<CallOutcome> {
  let outcome = await attempt(client, prompt, timeoutMs);
  for (let calls = 1; calls < MAX_CALLS; calls++) {
    if (outcome.ok || !RETRYABLE.has(outcome.error.kind)) break;
    outcome = await attempt(client, prompt, timeoutMs);
  }
  return outcome;
}
