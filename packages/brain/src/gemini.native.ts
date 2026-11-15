/**
 * Gemini adapter for React Native: the `react-native` condition of
 * `@lazarus/brain/gemini`.
 *
 * It calls the Gemini REST endpoint with `fetch` instead of the SDK, and it
 * never reads the process environment: an absent `env` means no key. The key
 * travels only in the `x-goog-api-key` header, never in the URL, an error
 * message or a log line. The shared logic lives in `gemini.core.ts`.
 */
import type { AiClient } from './ai.types.js';
import { resolveModel } from './models.js';
import { createGeminiCore, type GenaiLike, type GeminiOptions } from './gemini.core.js';

export {
  mapSdkError,
  createGeminiCore,
  type EnvConfig,
  type GenaiLike,
  type GeminiOptions,
} from './gemini.core.js';

/** Minimal fetch shape; brain's tsconfig has no DOM lib. */
export interface FetchLike {
  (
    url: string,
    init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: unknown },
  ): Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;
}

export interface NativeGeminiOptions extends GeminiOptions {
  /** Default: the global `fetch`, looked up at call time. */
  readonly fetch?: FetchLike;
  /** Per-request abort time. Default: 25 000 ms. */
  readonly requestTimeoutMs?: number;
}

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 25_000;

/** Thrown for a non-2xx response. `message` is the API status name or `HTTP <status>`. */
export class GeminiHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GeminiHttpError';
    this.status = status;
  }
}

type GenerateParams = Parameters<GenaiLike['models']['generateContent']>[0];

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** Joins `candidates[0].content.parts[*].text`; anything malformed gives ''. */
function textFromBody(body: unknown): string {
  const candidates = field(body, 'candidates');
  const first: unknown = Array.isArray(candidates) ? candidates[0] : undefined;
  const parts = field(field(first, 'content'), 'parts');
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part: unknown) => field(part, 'text'))
    .filter((text): text is string => typeof text === 'string')
    .join('');
}

/** The API's `error.status` name (e.g. `RESOURCE_EXHAUSTED`) when it is a plain upper-case word. */
function errorStatusName(body: unknown): string | undefined {
  const name = field(field(body, 'error'), 'status');
  return typeof name === 'string' && /^[A-Z_]{1,64}$/.test(name) ? name : undefined;
}

async function httpError(response: Awaited<ReturnType<FetchLike>>): Promise<GeminiHttpError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return new GeminiHttpError(response.status, errorStatusName(body) ?? `HTTP ${response.status}`);
}

function requestBody(params: GenerateParams): string {
  return JSON.stringify({
    systemInstruction: { parts: [{ text: params.config.systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: params.contents }] }],
    generationConfig: {
      maxOutputTokens: params.config.maxOutputTokens,
      temperature: params.config.temperature,
    },
  });
}

function abortError(): Error {
  const error = new Error('Gemini request timed out');
  error.name = 'AbortError';
  return error;
}

/**
 * Runs `send` with an AbortSignal and rejects with an `AbortError` after
 * `timeoutMs`, even if the fetch ignores the signal.
 */
function withTimeout<T>(timeoutMs: number, send: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(abortError());
    }, timeoutMs);
  });
  const sent = Promise.resolve().then(() => send(controller.signal));
  return Promise.race([sent, timeout]).finally(() => clearTimeout(timer));
}

/** A `GenaiLike` over the Gemini REST API. The key goes only in the header. */
export function createRestGenai(apiKey: string, fetch: FetchLike, timeoutMs: number = DEFAULT_TIMEOUT_MS): GenaiLike {
  return {
    models: {
      async generateContent(params: GenerateParams): Promise<{ readonly text?: string }> {
        const url = `${API_BASE}/${encodeURIComponent(params.model)}:generateContent`;
        const response = await withTimeout(timeoutMs, (signal) =>
          fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            body: requestBody(params),
            signal,
          }),
        );
        if (!response.ok) throw await httpError(response);
        return { text: textFromBody(await response.json()) };
      },
    },
  };
}

/** Global `fetch`, looked up per call so a later replacement is honoured. */
const globalFetch: FetchLike = (url, init) =>
  globalThis.fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal as AbortSignal | undefined,
  });

export function createGeminiClient(options: NativeGeminiOptions = {}): AiClient {
  const env = options.env ?? {};
  const model = resolveModel(options.model, env.GEMINI_MODEL);
  const fetch = options.fetch ?? globalFetch;
  const genai = options.genai ?? ((key: string): GenaiLike => createRestGenai(key, fetch, options.requestTimeoutMs));
  return createGeminiCore(env.GEMINI_API_KEY, model, genai, options.log);
}
