// Number functions (necromancer-sms-gateway design, "Number functions";
// Requirement 2). Pure: normalize, print and mask phone numbers.
import type { CanonicalNumber, SenderIdentity } from './gateway.types.js';

/** Used when the Default_Country_Code is absent or invalid (Requirement 2.12). */
export const FALLBACK_COUNTRY_CODE = '92';

const MASK_CHAR = '•';
const KEPT_TAIL = 3;
const MIN_DIGITS = 7;
const MAX_DIGITS = 15;

const CANONICAL_RE = /^\+[1-9]\d{6,14}$/;
const COUNTRY_CODE_RE = /^[1-9]\d{0,2}$/;
const ALLOWED_CHARS_RE = /^\+?[0-9 .()-]*$/;
const SEPARATORS_RE = /[ .()-]/g;

/** True for `+` followed by 7 to 15 digits, the first from 1 to 9. */
export function isCanonicalNumber(value: string): value is CanonicalNumber {
  return CANONICAL_RE.test(value);
}

/** True for 1 to 3 digits whose first digit is from 1 to 9 (Requirement 2.12). */
export function isValidCountryCode(value: string): boolean {
  return COUNTRY_CODE_RE.test(value);
}

/** Requirement 2.7: identical to the Canonical_Number. */
export function printNumber(number: CanonicalNumber): string {
  return number;
}

/** Requirement 2.9: '+' kept, all digits but the last 3 become '•'. */
export function maskNumber(number: CanonicalNumber): string {
  const digits = number.slice(1);
  const hidden = digits.length - KEPT_TAIL;
  return '+' + MASK_CHAR.repeat(hidden) + digits.slice(hidden);
}

/** Requirement 2.13: keep the last 3 UTF-16 code units, mask the rest. */
export function maskSender(address: string): string {
  if (address.length === 0) return MASK_CHAR;
  if (address.length <= KEPT_TAIL) return address;
  const hidden = address.length - KEPT_TAIL;
  return MASK_CHAR.repeat(hidden) + address.slice(hidden);
}

function automated(address: string): SenderIdentity {
  return { kind: 'automated', masked: maskSender(address) };
}

function inDigitRange(digits: string): boolean {
  return digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS;
}

/** Step 3: candidate digits from the stripped address, or null. */
function candidateDigits(stripped: string, countryCode: string): string | null {
  if (stripped.startsWith('+')) return stripped.slice(1);
  if (stripped.startsWith('00')) return stripped.slice(2);
  if (/^0[1-9]/.test(stripped)) return countryCode + stripped.slice(1);
  if (/^[1-9]/.test(stripped)) return stripped;
  return null;
}

/** Requirement 2.1–2.5, 2.11, 2.12. */
export function normalizeSender(address: string, defaultCountryCode?: string): SenderIdentity {
  if (!ALLOWED_CHARS_RE.test(address)) return automated(address);
  const stripped = address.replace(SEPARATORS_RE, '');
  const countryCode =
    defaultCountryCode !== undefined && isValidCountryCode(defaultCountryCode)
      ? defaultCountryCode
      : FALLBACK_COUNTRY_CODE;
  const candidate = candidateDigits(stripped, countryCode);
  const originalDigits = stripped.replace('+', '');
  if (candidate === null || !inDigitRange(originalDigits)) return automated(address);
  const number = '+' + candidate;
  return isCanonicalNumber(number) ? { kind: 'phone', number } : automated(address);
}
