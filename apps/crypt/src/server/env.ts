import 'server-only';

export interface GeminiEnv {
  readonly apiKey: string | null;
  readonly model: string | undefined;
}

/**
 * The only place in the Crypt_App that reads environment variables (1.6).
 * Reads `GEMINI_API_KEY` and `GEMINI_MODEL` and nothing else.
 * - `apiKey`: the raw value when it has a non-whitespace character, else `null` (9.3).
 * - `model`: the trimmed value when non-empty, else `undefined`, so the brain's
 *   default model is used (1.7, 9.2).
 */
export function readGeminiEnv(source: NodeJS.ProcessEnv = process.env): GeminiEnv {
  const rawKey = source.GEMINI_API_KEY;
  const rawModel = source.GEMINI_MODEL?.trim();
  return {
    apiKey: rawKey !== undefined && /\S/.test(rawKey) ? rawKey : null,
    model: rawModel === undefined || rawModel === '' ? undefined : rawModel,
  };
}
