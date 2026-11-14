// Scam_Parser and Scam_Printer: model output <-> Scam_Result. Pure: no I/O,
// no clock, no randomness. Markdown is stripped by the service before
// `parseScam`, so the round trip is exact for every valid Scam_Result.
// _Requirements: 9.2, 9.3, 9.5, 9.6, 9.7_
import type { Language } from './router.types.js';
import type { ScamResult, ScamVerdict } from './answer.types.js';
import { FIXED_TEXTS, MAX_REASON_CODE_POINTS } from './answer.texts.js';
import { normalizeMessage } from './normalize.js';

const VERDICTS: readonly ScamVerdict[] = ['SCAM', 'SAFE', 'UNSURE'];

/** Normalizes a verdict word for lookup: NFKC, collapsed spaces, upper case. */
function verdictKey(word: string): string {
  return normalizeMessage(word).toUpperCase();
}

/** Matches a verdict word against the canonical tokens and the localized words. */
function lookupVerdict(word: string, language: Language): ScamVerdict | undefined {
  const key = verdictKey(word);
  const localized = FIXED_TEXTS[language].scamWord;
  return VERDICTS.find((verdict) => key === verdict || key === verdictKey(localized[verdict]));
}

/** Caps `text` to MAX_REASON_CODE_POINTS code points; trims a trailing space left by the cut. */
function capReason(text: string): string {
  const points = Array.from(text);
  if (points.length <= MAX_REASON_CODE_POINTS) {
    return text;
  }
  return points.slice(0, MAX_REASON_CODE_POINTS).join('').trimEnd();
}

/** First line of `output` that has a non-whitespace character, or undefined. */
function firstNonBlankLine(output: string): string | undefined {
  return output.split(/\r\n|\r|\n/).find((line) => line.trim() !== '');
}

/** Result for output that cannot be parsed (Requirement 9.5). */
function unparseable(language: Language): ScamResult {
  return { verdict: 'UNSURE', reason: FIXED_TEXTS[language].scamReason.unparseable };
}

/**
 * Parses model output into a Scam_Result. Total: never throws.
 * - No non-blank line, no colon, or empty verdict part: `UNSURE` with the
 *   fixed unparseable Reason.
 * - Unknown verdict word: `UNSURE` (Requirement 9.6).
 * - Blank Reason: the fixed Reason for the verdict (Requirement 9.7).
 */
export function parseScam(output: string, language: Language): ScamResult {
  const line = firstNonBlankLine(output);
  const colon = line === undefined ? -1 : line.indexOf(':');
  if (line === undefined || colon === -1) {
    return unparseable(language);
  }
  const word = line.slice(0, colon);
  if (word.trim() === '') {
    return unparseable(language);
  }
  const verdict = lookupVerdict(word, language) ?? 'UNSURE';
  const reason = capReason(normalizeMessage(line.slice(colon + 1)));
  return { verdict, reason: reason === '' ? FIXED_TEXTS[language].scamReason[verdict] : reason };
}

/** Formats a Scam_Result as `<localized verdict word>: <reason>`. No shortening. */
export function printScam(result: ScamResult, language: Language): string {
  return `${FIXED_TEXTS[language].scamWord[result.verdict]}: ${result.reason}`;
}
