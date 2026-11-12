import { ROMAN_URDU_ALIASES } from './aliases.js';
import { normalizeMessage } from './normalize.js';
import type { Language } from './router.types.js';

/** Matches any Urdu script character (Arabic, Supplement, Presentation Forms A and B). */
export const URDU_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** Common Roman Urdu words. Short ambiguous English words are excluded on purpose. */
export const ROMAN_URDU_MARKERS: ReadonlySet<string> = new Set([
  'kya', 'hai', 'hain', 'mein', 'main', 'kaise', 'kaisa', 'nahi', 'nahin',
  'aap', 'meri', 'mera', 'mere', 'karo', 'kar', 'ka', 'ki', 'ke', 'ko',
  'se', 'ho', 'hoga', 'chahiye', 'kab', 'kahan', 'kyun', 'kitna', 'bhai',
  'shukriya', 'acha',
]);

const LATIN_WORD = /^[\x21-\x7E]+$/;
const EDGE_PUNCT = /^[!-/:-@[-`{-~]+|[!-/:-@[-`{-~]+$/g;

function toLatinWords(text: string): string[] {
  const words: string[] = [];
  for (const token of text.split(' ')) {
    if (!LATIN_WORD.test(token)) continue;
    words.push(token.replace(EDGE_PUNCT, '').toLowerCase());
  }
  return words;
}

export function detectLanguage(input: string): Language {
  const text = normalizeMessage(input);
  if (URDU_RE.test(text)) return 'ur';
  const words = toLatinWords(text);
  const first = words[0];
  if (first === undefined) return 'en';
  if (ROMAN_URDU_ALIASES.has(first)) return 'roman-ur';
  return words.some((w) => ROMAN_URDU_MARKERS.has(w)) ? 'roman-ur' : 'en';
}
