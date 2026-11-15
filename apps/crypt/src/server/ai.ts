import 'server-only';
import { createMemoryCache, type AiClient, type AnswerCache, type AnswerDeps } from '@lazarus/brain';
import { createGeminiClient, type EnvConfig } from '@lazarus/brain/gemini';
import { readGeminiEnv, type GeminiEnv } from './env';

/** The answer dependencies and the secrets to redact, shared by every request of one instance. */
export interface AiSetup {
  readonly answer: AnswerDeps | null;
  readonly secrets: readonly string[];
}

/** Factories for the AiClient and Answer_Cache, injectable so tests need no real Gemini client. */
export interface AiFactories {
  readonly createClient: (env: EnvConfig) => AiClient;
  readonly createCache: () => AnswerCache;
}

const REAL_FACTORIES: AiFactories = {
  // No `log` option: the Gemini adapter logs nothing (7.11).
  createClient: (env) => createGeminiClient({ env }),
  createCache: () => createMemoryCache(),
};

/**
 * Builds the AI setup from the Gemini env (9.1–9.3).
 * With a key: one AiClient and one Answer_Cache, and the key in `secrets`.
 * Without a key: no client, `answer: null`, so QUESTION and SCAM get the Try_Later_Text.
 * The env is passed explicitly, so the brain adapter never reads `process.env` (1.6).
 */
export function createAiSetup(env: GeminiEnv, factories: AiFactories = REAL_FACTORIES): AiSetup {
  if (env.apiKey === null) return { answer: null, secrets: [] };
  const geminiEnv: EnvConfig =
    env.model === undefined
      ? { GEMINI_API_KEY: env.apiKey }
      : { GEMINI_API_KEY: env.apiKey, GEMINI_MODEL: env.model };
  const secrets = [env.apiKey];
  return {
    answer: {
      client: factories.createClient(geminiEnv),
      cache: factories.createCache(),
      clock: Date.now,
      secrets,
    },
    secrets,
  };
}

let instanceSetup: AiSetup | null = null;

/** Lazy per-instance singleton: the client and cache are created once and reused (9.1). */
export function getAiSetup(): AiSetup {
  instanceSetup ??= createAiSetup(readGeminiEnv());
  return instanceSetup;
}
