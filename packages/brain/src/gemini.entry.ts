/**
 * Gemini adapter for Node: the production AiClient.
 *
 * This is the only file that imports `@google/genai` and, with
 * `gemini.native.ts`, the only file that reads `GEMINI_API_KEY` and
 * `GEMINI_MODEL`. It is a separate entry point (`@lazarus/brain/gemini`) and
 * is not exported from `index.ts`. The shared logic lives in `gemini.core.ts`.
 */
import { GoogleGenAI } from '@google/genai';
import type { AiClient } from './ai.types.js';
import { resolveModel } from './models.js';
import { createGeminiCore, type EnvConfig, type GenaiLike, type GeminiOptions } from './gemini.core.js';

export {
  mapSdkError,
  createGeminiCore,
  type EnvConfig,
  type GenaiLike,
  type GeminiOptions,
} from './gemini.core.js';

/** The only place the SDK constructor is written. */
function defaultGenai(apiKey: string): GenaiLike {
  return new GoogleGenAI({ apiKey });
}

/** Reads only the two Gemini variables; touches `process.env` only when no env is given. */
function readEnv(env: EnvConfig | undefined): EnvConfig {
  if (env !== undefined) return env;
  return {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
  };
}

export function createGeminiClient(options: GeminiOptions = {}): AiClient {
  const env = readEnv(options.env);
  const model = resolveModel(options.model, env.GEMINI_MODEL);
  return createGeminiCore(env.GEMINI_API_KEY, model, options.genai ?? defaultGenai, options.log);
}
