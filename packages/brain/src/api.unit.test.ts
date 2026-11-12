// Unit tests for the public splitSms / joinSms API.
//
// Example-based tests covering empty input, prefixing, round-tripping,
// prefix-shaped single-part input and the empty-parts edge case.

import { describe, it, expect } from 'vitest';
import { joinSms, splitSms } from './index.js';

// _Requirements: 2.1, 7.1, 7.3, 8.1, 8.2_
describe('SMS Message Splitter — public API (unit)', () => {
  it('splits an empty string to [""] and joins [""] back to ""', () => {
    expect(splitSms('')).toEqual(['']);
    expect(joinSms([''])).toBe('');
  });

  it('joins an empty parts array to ""', () => {
    expect(joinSms([])).toBe('');
  });

  it('prefixes and round-trips a 2-part GSM-7 reply', () => {
    const text = 'abcd '.repeat(40);
    expect(text).toHaveLength(200);

    const parts = splitSms(text);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.startsWith('(1/2) ')).toBe(true);
    expect(parts[1]?.startsWith('(2/2) ')).toBe(true);
    expect(joinSms(parts)).toBe(text);
  });

  it('prefixes and round-trips a 2-part UCS-2 reply', () => {
    const text = 'سلام '.repeat(20);

    const parts = splitSms(text);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.startsWith('(1/2) ')).toBe(true);
    expect(parts[1]?.startsWith('(2/2) ')).toBe(true);
    expect(joinSms(parts)).toBe(text);
  });

  it('adds no prefix to a single-part reply', () => {
    const parts = splitSms('Hello there');
    expect(parts).toEqual(['Hello there']);
  });

  it('leaves a prefix-shaped single message untouched in both directions', () => {
    expect(splitSms('(1/2) Hello')).toEqual(['(1/2) Hello']);
    expect(joinSms(['(1/2) Hello'])).toBe('(1/2) Hello');
  });

  it('round-trips a reply of up to 4 parts without truncation', () => {
    const text = 'abcd '.repeat(100);
    expect(text).toHaveLength(500);

    const parts = splitSms(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.length).toBeLessThanOrEqual(4);
    expect(parts.some((p) => p.endsWith('...'))).toBe(false);
    expect(joinSms(parts)).toBe(text);
  });
});
