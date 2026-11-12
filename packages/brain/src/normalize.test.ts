// Unit tests for normalizeMessage.
// _Requirements: 2.2, 2.3, 2.5_

import { describe, it, expect } from 'vitest';
import { normalizeMessage } from './normalize.js';

describe('normalizeMessage', () => {
  it('converts tabs between tokens to a single space (Req 2.3)', () => {
    expect(normalizeMessage('scam\tfree\tmoney')).toBe('scam free money');
  });

  it('converts newlines between tokens to a single space (Req 2.3)', () => {
    expect(normalizeMessage('remind\n5pm\r\ncall mom')).toBe('remind 5pm call mom');
  });

  it('collapses mixed tab/newline/space runs to one space (Req 2.2, 2.3)', () => {
    expect(normalizeMessage('a \t\n  b')).toBe('a b');
  });

  it('collapses repeated spaces (Req 2.2)', () => {
    expect(normalizeMessage('help    me   now')).toBe('help me now');
  });

  it('removes leading and trailing whitespace (Req 2.2)', () => {
    expect(normalizeMessage('   stop  ')).toBe('stop');
    expect(normalizeMessage('\t\nhello world\n\t')).toBe('hello world');
  });

  it('returns empty string for empty input (Req 2.5)', () => {
    expect(normalizeMessage('')).toBe('');
  });

  it('returns empty string for whitespace-only input (Req 2.5)', () => {
    expect(normalizeMessage(' \t\n\r  ')).toBe('');
  });

  it('applies NFKC to fullwidth characters', () => {
    expect(normalizeMessage('ＳＴＯＰ')).toBe('STOP');
    expect(normalizeMessage('ｈｅｌｐ　ｍｅ')).toBe('help me');
  });

  it('treats ideographic and no-break spaces as whitespace', () => {
    expect(normalizeMessage('a\u3000b\u00A0c')).toBe('a b c');
  });

  it('preserves case and inner characters', () => {
    expect(normalizeMessage('  Hello,  WORLD! 123 ')).toBe('Hello, WORLD! 123');
  });

  it('is idempotent on a sample', () => {
    const once = normalizeMessage(' ＡＢ \t c  ');
    expect(normalizeMessage(once)).toBe(once);
  });
});
