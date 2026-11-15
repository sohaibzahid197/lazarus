// Feature: necromancer-sms-gateway, Property 32: API key validator rule
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GATEWAY_PBT_OPTIONS, apiKey } from './gateway.arbitraries.js';
import { validateApiKey } from './gateway.key.js';

/** Independent reference: char-by-char check of the trimmed value, no regex. */
function isKeyChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  const upper = c >= 65 && c <= 90;
  const lower = c >= 97 && c <= 122;
  const digit = c >= 48 && c <= 57;
  return upper || lower || digit || ch === '_' || ch === '-';
}

function referenceAccepts(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 30 || t.length > 64) return false;
  for (let i = 0; i < t.length; i += 1) {
    if (!isKeyChar(t.charAt(i))) return false;
  }
  return true;
}

const KEY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split('');
const keyCharArb = fc.constantFrom(...KEY_CHARS);

/** Whitespace that JS `trim()` removes, including non-ASCII spaces. */
const WHITESPACE = [' ', '\t', '\n', '\r', '\v', '\f', '\u00a0', '\u2003', '\u3000', '\ufeff'];
const padArb = fc.string({ unit: fc.constantFrom(...WHITESPACE), maxLength: 4 });

/** Key-character strings with lengths at and around the 30 and 64 limits. */
const nearLimitArb = fc
  .constantFrom(0, 1, 28, 29, 30, 31, 63, 64, 65, 66)
  .chain((n) => fc.string({ unit: keyCharArb, minLength: n, maxLength: n }));

/** Characters outside the allowed set, including look-alikes and inner spaces. */
const BAD_CHARS = [' ', '.', '+', '/', '=', '!', '@', '\u00e9', '\u0627', '\u2010', '\t', '\u00a0'];

/** A valid key with one character replaced by a disallowed character. */
const badCharKeyArb = fc
  .tuple(apiKey, fc.nat(), fc.constantFrom(...BAD_CHARS))
  .map(([k, i, bad]) => {
    const at = i % k.length;
    return k.slice(0, at) + bad + k.slice(at + 1);
  });

const coreArb = fc.oneof(apiKey, nearLimitArb, badCharKeyArb, fc.string({ maxLength: 80 }));
const inputArb = fc
  .tuple(padArb, coreArb, padArb)
  .map(([left, core, right]) => left + core + right);

describe('validateApiKey rule', () => {
  /** **Validates: Requirements 16.3** */
  it('Req 16.3: accepts exactly when the trimmed value is 30 to 64 of A-Z a-z 0-9 _ -, and returns the trimmed key', () => {
    fc.assert(
      fc.property(inputArb, (raw) => {
        const result = validateApiKey(raw);
        expect(result.ok).toBe(referenceAccepts(raw));
        if (result.ok) expect(result.key).toBe(raw.trim());
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
