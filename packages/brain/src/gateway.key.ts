/** Api_Key_Validator and Key_Masker for the Gemini_Api_Key (Requirement 16). */

export type KeyCheck = { readonly ok: true; readonly key: string } | { readonly ok: false };

const API_KEY_PATTERN = /^[A-Za-z0-9_-]{30,64}$/;
const MASK_PREFIX = '••••';
const VISIBLE_TAIL = 4;

/** Fixed rejection text. It never includes the entered value (Requirement 16.4). */
export const API_KEY_INVALID_MESSAGE =
  'This is not a valid Gemini API key. A key is 30 to 64 letters, digits, hyphens or underscores.';

/** Trims the pasted value and accepts it only if it matches the key rule (Requirement 16.3). */
export function validateApiKey(raw: string): KeyCheck {
  const key = raw.trim();
  return API_KEY_PATTERN.test(key) ? { ok: true, key } : { ok: false };
}

/** Returns `••••` followed by the last 4 characters of the key (Requirement 16.12). */
export function maskApiKey(key: string): string {
  return MASK_PREFIX + key.slice(-VISIBLE_TAIL);
}
