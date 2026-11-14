// Cache_Key builder for the Answer_Cache. Pure: no I/O, no clock.
// _Requirements: 7.1, 7.5, 7.7_
import type { Language, RequestKind } from './answer.types.js';
import { normalizeMessage } from './normalize.js';

/** Lower-cases only ASCII Latin letters A-Z; every other character is kept. */
function foldLatin(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * Key built from exactly the request kind, the Language and the folded
 * Normalized_Message. JSON encoding keeps the parts unambiguous. No sender data.
 */
export function buildCacheKey(kind: RequestKind, language: Language, text: string): string {
  return JSON.stringify([kind, language, foldLatin(normalizeMessage(text))]);
}
