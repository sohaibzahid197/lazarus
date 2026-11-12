// SMS encoding detection per 3GPP TS 23.038.
//
// A message is GSM-7 encodable only when every one of its characters
// belongs to the GSM 7-bit default alphabet (basic table) or the GSM 7-bit
// extension table. Any character outside those two tables forces the whole
// message into UCS-2 (UTF-16) encoding.

/**
 * Encoding tag for an SMS message body.
 * - `'GSM-7'` — every character fits the 7-bit default/extension alphabet.
 * - `'UCS-2'` — at least one character requires UTF-16 (UCS-2) encoding.
 */
export type SmsEncoding = 'GSM-7' | 'UCS-2';

/**
 * GSM 7-bit default alphabet (3GPP TS 23.038 §6.2.1), the printable
 * characters, space, and the control characters LF (0x0A) and CR (0x0D).
 *
 * The ESC escape prefix (0x1B) is intentionally excluded: it is a control
 * code used only to introduce extension characters, not a standalone
 * printable character.
 *
 * Notably **not** in this set: the backtick/grave accent (`` ` ``), and
 * every character outside the 3GPP table.
 *
 * Every member is a single BMP code unit, so the string is split with the
 * spread operator (code-point safe) rather than `split('')`.
 */
export const GSM_7_BASIC: Set<string> = new Set<string>([
  // 0x00–0x0F: @ £ $ ¥ è é ù ì ò Ç LF Ø ø CR Å å
  ...'@£$¥èéùìòÇ\nØø\rÅå',
  // 0x10–0x1F: Δ _ Φ Γ Λ Ω Π Ψ Σ Θ Ξ (skip ESC 0x1B) Æ æ ß É
  ...'Δ_ΦΓΛΩΠΨΣΘΞÆæßÉ',
  // 0x20–0x2F: space ! " # ¤ % & ' ( ) * + , - . /
  ..." !\"#¤%&'()*+,-./",
  // 0x30–0x3F: 0–9 : ; < = > ?
  ...'0123456789:;<=>?',
  // 0x40–0x5F: ¡ A–Z Ä Ö Ñ Ü §
  ...'¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§',
  // 0x60–0x7F: ¿ a–z à ä ö ñ ü
  ...'¿abcdefghijklmnopqrstuvwxyzàäöñü',
]);

/**
 * GSM 7-bit extension table (3GPP TS 23.038 §6.2.1.1). Each of these
 * characters is encoded as an ESC prefix plus the character, costing
 * 2 code units instead of 1.
 */
export const GSM_7_EXTENSION: Set<string> = new Set<string>([
  '^',
  '{',
  '}',
  '\\',
  '[',
  '~',
  ']',
  '|',
  '€',
]);

/**
 * Returns `true` when `ch` is a member of the GSM-7 default (basic)
 * alphabet.
 *
 * @param ch - A single character (one code point).
 */
export function isGsm7Basic(ch: string): boolean {
  return GSM_7_BASIC.has(ch);
}

/**
 * Returns `true` when `ch` is a member of the GSM-7 extension table.
 * Extension characters cost 2 code units when encoded.
 *
 * @param ch - A single character (one code point).
 */
export function isGsm7Extension(ch: string): boolean {
  return GSM_7_EXTENSION.has(ch);
}

/**
 * Returns `true` when `ch` is encodable in GSM-7, i.e. it belongs to the
 * basic alphabet or the extension table.
 *
 * @param ch - A single character (one code point).
 */
export function isGsm7(ch: string): boolean {
  return isGsm7Basic(ch) || isGsm7Extension(ch);
}

/**
 * Determines the encoding for an entire message.
 *
 * Returns `'UCS-2'` when *any* code point of `text` is not encodable in
 * GSM-7 (basic or extension); otherwise returns `'GSM-7'`. Encoding is
 * decided for the whole message: a single non-GSM-7 character forces
 * UCS-2 for the entire text.
 *
 * Iterates by code point (`for...of`) so that supplementary characters
 * such as emoji (represented as surrogate pairs in UTF-16) are treated as
 * a single unit and correctly classified as non-GSM-7.
 *
 * @param text - The message body to classify.
 */
export function detectEncoding(text: string): SmsEncoding {
  for (const ch of text) {
    if (!isGsm7(ch)) {
      return 'UCS-2';
    }
  }
  return 'GSM-7';
}
