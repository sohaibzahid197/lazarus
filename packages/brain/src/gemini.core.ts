/**
 * Gemini core: the AiClient logic shared by the Node entry (`gemini.entry.ts`,
 * `@google/genai` SDK) and the React Native entry (`gemini.native.ts`, REST).
 *
 * This file imports no SDK and never reads `process.env`. The caller passes the
 * key, the resolved model and the `GenaiLike` factory.
 *
 * Free tier only: one `models.generateContent` call per attempt, with no
 * tools, grounding, cached content, batch jobs or other billing-only features.
 */
import { AiError, isAiError, type AiClient, type Prompt } from './ai.types.js';
import { maskPhoneNumbers, redactSecrets } from './answer.redact.js';

const MAX_OUTPUT_TOKENS = 300;
const TEMPERATURE = 0.3;
const MISSING_KEY_MESSAGE = 'GEMINI_API_KEY is not configured';
const REQUEST_FAILED_MESSAGE = 'Gemini request failed';

/** The used part of the SDK: only models.generateContent. */
export interface GenaiLike {
  readonly models: {
    generateContent(params: {
      model: string;
      contents: string;
      config: {
        systemInstruction: string;
        maxOutputTokens: number;
        temperature: number;
      };
    }): Promise<{ readonly text?: string }>;
  };
}

export interface EnvConfig {
  readonly GEMINI_API_KEY?: string;
  readonly GEMINI_MODEL?: string;
}

export interface GeminiOptions {
  /** Default: `process.env` on Node; no key on React Native. */
  readonly env?: EnvConfig;
  /** Factory option wins over `GEMINI_MODEL`. */
  readonly model?: string;
  /** Injectable SDK factory. Default depends on the entry point (SDK on Node, REST on React Native). */
  readonly genai?: (apiKey: string) => GenaiLike;
  /** Default: no-op. Every line is redacted and phone-masked first. */
  readonly log?: (line: string) => void;
}

const TIMEOUT_STATUSES: ReadonlySet<number> = new Set([408, 504]);
const TIMEOUT_NAMES: ReadonlySet<string> = new Set(['AbortError', 'TimeoutError']);
const TIMEOUT_CODES: ReadonlySet<string> = new Set(['timeout', 'ETIMEDOUT']);
const NETWORK_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** The fields of an SDK error that the mapping looks at. */
interface ErrorFacts {
  readonly status: number | undefined;
  readonly name: string | undefined;
  readonly code: string | undefined;
  /** Detection only: never copied into an AiError message or log. */
  readonly text: string;
}

/** Reads one property; any throwing getter or proxy trap gives `undefined`. */
function readField(error: unknown, field: string): unknown {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
    return undefined;
  }
  try {
    return (error as Record<string, unknown>)[field];
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function readFacts(error: unknown): ErrorFacts {
  const rawStatus = readField(error, 'status');
  const textParts = [
    asString(error),
    asString(rawStatus),
    asString(readField(error, 'statusText')),
    asString(readField(error, 'message')),
  ];
  return {
    status: asStatus(rawStatus),
    name: asString(readField(error, 'name')),
    code: asString(readField(error, 'code')),
    text: textParts.filter((part): part is string => part !== undefined).join(' '),
  };
}

function isQuota(facts: ErrorFacts): boolean {
  return facts.status === 429 || facts.text.includes('RESOURCE_EXHAUSTED');
}

function isTimeout(facts: ErrorFacts): boolean {
  return (
    (facts.status !== undefined && TIMEOUT_STATUSES.has(facts.status)) ||
    (facts.name !== undefined && TIMEOUT_NAMES.has(facts.name)) ||
    (facts.code !== undefined && TIMEOUT_CODES.has(facts.code))
  );
}

function isNetwork(facts: ErrorFacts): boolean {
  return (
    (facts.status !== undefined && facts.status >= 500) ||
    facts.name === 'TypeError' ||
    (facts.code !== undefined && NETWORK_CODES.has(facts.code))
  );
}

/** Fixed description plus the numeric status; never the SDK text or the key. */
function failureMessage(status: number | undefined): string {
  return status === undefined ? REQUEST_FAILED_MESSAGE : `${REQUEST_FAILED_MESSAGE} (status ${status})`;
}

function safeIsAiError(error: unknown): error is AiError {
  try {
    return isAiError(error);
  } catch {
    return false;
  }
}

/**
 * Maps an SDK error to an AiError. Pure and never throws.
 *
 * Order: existing AiError unchanged; 429 or `RESOURCE_EXHAUSTED` is `quota`;
 * 408/504, `AbortError`/`TimeoutError` or `timeout`/`ETIMEDOUT` is `timeout`;
 * other 5xx, `TypeError` or a connection code is `network`; everything else,
 * including 400/401/403/404, billing and permission errors, is `unknown`.
 * The caller does not retry on another model or feature.
 */
export function mapSdkError(error: unknown): AiError {
  if (safeIsAiError(error)) return error;
  const facts = readFacts(error);
  const message = failureMessage(facts.status);
  if (isQuota(facts)) return new AiError('quota', message);
  if (isTimeout(facts)) return new AiError('timeout', message);
  if (isNetwork(facts)) return new AiError('network', message);
  return new AiError('unknown', message);
}

function unconfiguredClient(log: (line: string) => void): AiClient {
  return {
    complete(): Promise<string> {
      log(`gemini: ${MISSING_KEY_MESSAGE}`);
      return Promise.reject(new AiError('unknown', MISSING_KEY_MESSAGE));
    },
  };
}

function textOf(response: { readonly text?: unknown }): string {
  return typeof response.text === 'string' ? response.text : '';
}

function trimmedKey(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Builds the AiClient around a `GenaiLike` factory.
 *
 * `key` is trimmed; an empty key gives a client that always rejects with
 * `unknown`. `model` must already be resolved. Every log line is redacted
 * (the key) and phone-masked before it reaches `log`. The factory is called
 * lazily, once, on the first `complete`.
 */
export function createGeminiCore(
  key: string | undefined,
  model: string,
  makeGenai: (apiKey: string) => GenaiLike,
  log?: (line: string) => void,
): AiClient {
  const cleanKey = trimmedKey(key);
  const rawLog = log ?? ((): void => undefined);
  const safeLog = (line: string): void => rawLog(maskPhoneNumbers(redactSecrets(line, [cleanKey])));

  if (cleanKey === '') return unconfiguredClient(safeLog);

  let ai: GenaiLike | undefined;

  return {
    async complete(prompt: Prompt): Promise<string> {
      try {
        ai ??= makeGenai(cleanKey);
        safeLog(`gemini: request model=${model}`);
        const response = await ai.models.generateContent({
          model,
          contents: prompt.user,
          config: {
            systemInstruction: prompt.system,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            temperature: TEMPERATURE,
          },
        });
        return textOf(response);
      } catch (error: unknown) {
        const mapped = mapSdkError(error);
        safeLog(`gemini: error kind=${mapped.kind} ${mapped.message}`);
        throw mapped;
      }
    },
  };
}
