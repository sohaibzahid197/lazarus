// Text direction helpers for bubbles, examples and the Compose_Field
// (Requirements 5.5, 11.4, 16.7; design note on 16.7 vs 11.4).

const URDU = /[\u0600-\u06FF]/u;

/** Letters of right-to-left scripts (Arabic script covers Urdu). */
const RTL_LETTER = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;

/** Any letter: the strong directional characters this app cares about. */
const LETTER = /\p{L}/u;

/** True when the text has a character in U+0600–U+06FF; used for `lang="ur"`. */
export function hasUrdu(text: string): boolean {
  return URDU.test(text);
}

/**
 * Direction from the first strong character: a right-to-left script letter
 * gives `rtl`, any other letter (Latin) gives `ltr`, no letter gives `ltr`.
 * Digits, spaces, punctuation and marks are skipped as not strong.
 */
export function textDirection(text: string): 'rtl' | 'ltr' {
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    return RTL_LETTER.test(ch) ? 'rtl' : 'ltr';
  }
  return 'ltr';
}
