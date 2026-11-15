import { ALIAS_TABLE } from './aliases.js';

/** Keys of ALIAS_TABLE that map to STOP, in table order: ['stop', 'band', 'بند']. */
export const STOP_ALIAS_LIST: readonly string[] = Object.freeze(
  [...ALIAS_TABLE].filter(([, command]) => command === 'STOP').map(([alias]) => alias),
);

/** The characters the Command_Router strips from the end of the first token. */
export const KEYWORD_TRAILING_PUNCTUATION = '.,!?:;';

/** Fixed value stored in a Pending_Stop_Record in place of the body. */
export const STOP_MARKER = 'STOP';

/** Regex matching a run of KEYWORD_TRAILING_PUNCTUATION at the end of a string. */
export function trailingPunctuationRegex(): RegExp {
  const escaped = KEYWORD_TRAILING_PUNCTUATION.replace(/[\\\]^-]/g, '\\$&');
  return new RegExp(`[${escaped}]+$`);
}

const TRAILING = trailingPunctuationRegex();
const STOP_SET: ReadonlySet<string> = new Set(STOP_ALIAS_LIST);

/**
 * Reference model of the Kotlin fallback (Requirement 9.13 glossary definition).
 * Trim, take the first whitespace-separated token, strip trailing punctuation,
 * lowercase, test membership. Deliberately does not apply normalizeMessage.
 */
export function stopKeywordCheck(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed === '') return false;
  const token = trimmed.split(/\s+/, 1)[0] ?? '';
  const keyword = token.replace(TRAILING, '').toLowerCase();
  return STOP_SET.has(keyword);
}

/** Shape of the build-time `stop_aliases.json` asset read by the Kotlin check. */
export interface StopAliasAsset {
  readonly v: 1;
  readonly aliases: readonly string[];
  readonly trailingPunctuation: string;
  readonly stopMarker: string;
}

/** The asset value written by the export script. Returns a fresh object each call. */
export function stopAliasAsset(): StopAliasAsset {
  return {
    v: 1,
    aliases: [...STOP_ALIAS_LIST],
    trailingPunctuation: KEYWORD_TRAILING_PUNCTUATION,
    stopMarker: STOP_MARKER,
  };
}
