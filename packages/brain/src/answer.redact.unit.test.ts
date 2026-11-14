// Unit tests for the redactor (`answer.redact.ts`).
import { describe, it, expect } from 'vitest';
import { maskPhoneNumbers, redactSecrets } from './answer.redact.js';
import { REDACTED } from './answer.texts.js';

describe('redactSecrets', () => {
  it('returns the text unchanged for an empty secret list', () => {
    // Requirement 10.3
    expect(redactSecrets('key AIzaSecret here', [])).toBe('key AIzaSecret here');
  });

  it('ignores an empty-string secret and does not throw', () => {
    // Requirement 10.3
    expect(redactSecrets('hello world', [''])).toBe('hello world');
    expect(redactSecrets('key AIzaSecret', ['', 'AIzaSecret'])).toBe(`key ${REDACTED}`);
  });

  it('replaces every repeated occurrence of a secret', () => {
    // Requirement 10.2
    expect(redactSecrets('s3cret and s3cret again s3cret', ['s3cret'])).toBe(
      `${REDACTED} and ${REDACTED} again ${REDACTED}`,
    );
  });

  it('is case-sensitive', () => {
    // Requirement 10.2
    expect(redactSecrets('Secret secret', ['secret'])).toBe(`Secret ${REDACTED}`);
  });

  it('covers self-overlapping occurrences with one placeholder', () => {
    // Requirement 10.2: "abcab" occurs at 0 and 3 in "abcabcab"
    const out = redactSecrets('x abcabcab y', ['abcab']);
    expect(out).toBe(`x ${REDACTED} y`);
    expect(out).not.toContain('abcab');
  });

  it('covers overlapping occurrences of different secrets', () => {
    // Requirement 10.2
    const out = redactSecrets('xabcdx', ['abc', 'bcd']);
    expect(out).toBe(`x${REDACTED}x`);
    expect(out).not.toContain('abc');
    expect(out).not.toContain('bcd');
  });
});

describe('maskPhoneNumbers', () => {
  it('masks a +92 300-1234567 style number keeping +, spaces, hyphens and last 3 digits', () => {
    // Requirement 10.5
    expect(maskPhoneNumbers('from +92 300-1234567 today')).toBe('from +** ***-****567 today');
  });

  it('masks a plain 7-digit run', () => {
    // Requirement 10.5
    expect(maskPhoneNumbers('call 1234567')).toBe('call ****567');
  });

  it('leaves a six-digit run unchanged', () => {
    // Requirement 10.6
    expect(maskPhoneNumbers('code 123456 ok')).toBe('code 123456 ok');
    expect(maskPhoneNumbers('pin 123-456')).toBe('pin 123-456');
  });
});
