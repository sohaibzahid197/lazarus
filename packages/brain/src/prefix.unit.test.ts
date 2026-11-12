// Unit tests for the SMS part-prefix module.
//
// Example-based tests covering prefix formatting and stripping scenarios
// that complement the property-based tests. Each test references the
// requirement clause it validates.

import { describe, it, expect } from 'vitest';
import {
  formatPartPrefix,
  stripPartPrefix,
  PART_PREFIX_PATTERN,
} from './prefix.js';

// _Requirements: 7.1, 7.3_
//
// Requirement 7.1: WHEN the Reply has more than one part, the SMS_Splitter
// SHALL prefix each part with `(n/total) ` so the receiver can reassemble.
// Requirement 7.3: joinSms reassembles parts after stripping prefixes.
// stripPartPrefix is the helper that removes the leading prefix.
describe('SMS Message Splitter — part prefix (unit)', () => {
  // --- formatPartPrefix -------------------------------------------------

  it('formats the prefix for the first of two parts', () => {
    // Includes the trailing space.
    expect(formatPartPrefix(1, 2)).toBe('(1/2) ');
  });

  it('formats the prefix for the second of three parts', () => {
    expect(formatPartPrefix(2, 3)).toBe('(2/3) ');
  });

  it('formats a prefix for the last part', () => {
    expect(formatPartPrefix(4, 4)).toBe('(4/4) ');
  });

  // --- stripPartPrefix --------------------------------------------------

  it('strips a leading prefix and returns the remaining text', () => {
    expect(stripPartPrefix('(1/2) hi')).toBe('hi');
  });

  it('returns an empty string when the part is prefix-only', () => {
    // The prefix itself includes the trailing space, so stripping `(3/4) `
    // leaves nothing.
    expect(stripPartPrefix('(3/4) ')).toBe('');
  });

  it('is a no-op when no prefix is present', () => {
    expect(stripPartPrefix('hello')).toBe('hello');
  });

  it('is a no-op for text that merely resembles a prefix mid-string', () => {
    // A token shaped like a prefix but not at the start is left untouched.
    expect(stripPartPrefix('say (1/2) now')).toBe('say (1/2) now');
  });

  it('strips only the first prefix when multiple are present', () => {
    // Only one leading prefix is removed; an inner one stays verbatim.
    expect(stripPartPrefix('(1/2) (2/2) end')).toBe('(2/2) end');
  });

  it('is a no-op for a string that starts with an open paren but is not a prefix', () => {
    // `(1/2) ` requires the trailing space; missing it means no match.
    expect(stripPartPrefix('(1/2)hi')).toBe('(1/2)hi');
    expect(stripPartPrefix('(a/b) hi')).toBe('(a/b) hi');
  });

  // --- PART_PREFIX_PATTERN ----------------------------------------------

  it('matches a leading prefix and captures its full length', () => {
    const match = '(1/3) hello'.match(PART_PREFIX_PATTERN);
    expect(match).not.toBeNull();
    expect(match![0]).toBe('(1/3) ');
  });

  it('does not match a prefix lacking the trailing space', () => {
    expect(PART_PREFIX_PATTERN.test('(1/3)hello')).toBe(false);
  });
});
