import 'server-only';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Writes a non-negative safe integer in base 26 with the digits `a` to `z`
 * (`letters(0) = 'a'`, `letters(25) = 'z'`, `letters(26) = 'ba'`).
 * The result never holds a decimal digit (design C3).
 */
export function letters(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError('letters() needs a non-negative safe integer');
  }
  let rest = n;
  let out = '';
  do {
    out = ALPHABET.charAt(rest % 26) + out;
    rest = Math.floor(rest / 26);
  } while (rest > 0);
  return out;
}

/**
 * Message id for one inbound simulator message: deterministic for a given
 * Server_Time and receive count (7.14), digit-free (17.4). The brain's
 * Reminder_Id `r:<id>` stays at most 20 characters for any safe time and a
 * receive count of at most 120.
 */
export function messageIdFor(serverTime: number, receiveCount: number): string {
  return `m${letters(serverTime)}-${letters(receiveCount)}`;
}
