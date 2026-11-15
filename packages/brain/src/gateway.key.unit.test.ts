import { describe, expect, it } from 'vitest';
import { API_KEY_INVALID_MESSAGE, maskApiKey, validateApiKey } from './gateway.key.js';

/** Builds a key-shaped string of `length` from allowed characters. */
function keyOf(length: number): string {
  const alphabet = 'Kq0123456789_-abcdefghijklmnopqrstuvwxyzMN';
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[i % alphabet.length];
  return out;
}

describe('validateApiKey boundaries (Requirements 16.3, 18.10)', () => {
  it('accepts trimmed values of 30 and 64 characters', () => {
    for (const len of [30, 64]) {
      const key = keyOf(len);
      expect(validateApiKey(key)).toEqual({ ok: true, key });
    }
  });

  it('rejects trimmed values of 29 and 65 characters', () => {
    expect(validateApiKey(keyOf(29))).toEqual({ ok: false });
    expect(validateApiKey(keyOf(65))).toEqual({ ok: false });
  });

  it('rejects an empty value and a whitespace-only value', () => {
    expect(validateApiKey('')).toEqual({ ok: false });
    expect(validateApiKey(' \t\n  ')).toEqual({ ok: false });
  });

  it('rejects a value containing a character outside A-Z, a-z, 0-9, - and _', () => {
    expect(validateApiKey(`${keyOf(34)}!`)).toEqual({ ok: false });
    expect(validateApiKey(`${keyOf(15)}!${keyOf(15)}`)).toEqual({ ok: false });
  });

  it('accepts a valid key padded with spaces and returns it trimmed', () => {
    const key = keyOf(39);
    expect(validateApiKey(`   ${key}   `)).toEqual({ ok: true, key });
  });

  it('counts length after trimming, so padding does not push 64 over the limit', () => {
    const key = keyOf(64);
    expect(validateApiKey(`  ${key}  `)).toEqual({ ok: true, key });
  });
});

/*
 * "API_KEY_INVALID_MESSAGE contains no character of the input" (Requirement 16.4).
 * A fixed English message must share letters with some keys, so a literal reading
 * cannot hold for every input. We test the intent, that the message never echoes
 * the entered value, in three ways:
 *   (a) the message never contains any rejected input as a substring;
 *   (b) for rejected inputs built only from characters absent from the message,
 *       no character of the input appears in the message;
 *   (c) the message is a single constant, the same for every rejected input.
 */
describe('API_KEY_INVALID_MESSAGE does not echo the input (Requirement 16.4)', () => {
  const rejected = [
    keyOf(29),
    keyOf(65),
    ' \t ',
    `${keyOf(34)}!`,
    'Kq-short',
  ];

  it('(a) never contains a rejected input as a substring', () => {
    for (const input of rejected) {
      expect(validateApiKey(input).ok).toBe(false);
      expect(input.trim().length > 0 && API_KEY_INVALID_MESSAGE.includes(input.trim())).toBe(false);
    }
  });

  it('(b) shares no character with rejected inputs built from characters absent from it', () => {
    const absent = ['X', 'Q', 'Z', 'W', '7', '9', '!', '_', '-'];
    for (const ch of absent) expect(API_KEY_INVALID_MESSAGE).not.toContain(ch);
    const inputs = ['XQZ7!', 'X'.repeat(29), 'QZ79_-W'.repeat(10), `${'XQZW79'.repeat(6)}!`];
    for (const input of inputs) {
      expect(validateApiKey(input).ok).toBe(false);
      for (const ch of input) expect(API_KEY_INVALID_MESSAGE).not.toContain(ch);
    }
  });

  it('(c) is one fixed string that does not depend on the input', () => {
    expect(typeof API_KEY_INVALID_MESSAGE).toBe('string');
    expect(API_KEY_INVALID_MESSAGE).toBe(
      'This is not a valid Gemini API key. A key is 30 to 64 letters, digits, hyphens or underscores.',
    );
  });
});

describe('maskApiKey', () => {
  it('shows •••• plus the last 4 characters', () => {
    expect(maskApiKey('key-1234567890_abcdefghijklmnop')).toBe('••••mnop');
  });
});
