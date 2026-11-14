/**
 * Gemini model selection. Pure: reads no environment variables.
 * Google retires and renames models over time; change the default here only.
 */

/** Free-tier Flash-Lite model used when no option or GEMINI_MODEL is set. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

/**
 * Pick the model name: trimmed factory option if non-empty, else trimmed
 * env value if non-empty, else DEFAULT_GEMINI_MODEL.
 */
export function resolveModel(
  option: string | undefined,
  envValue: string | undefined,
): string {
  const fromOption = typeof option === 'string' ? option.trim() : '';
  if (fromOption !== '') return fromOption;
  const fromEnv = typeof envValue === 'string' ? envValue.trim() : '';
  if (fromEnv !== '') return fromEnv;
  return DEFAULT_GEMINI_MODEL;
}
