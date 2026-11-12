// Unit tests for the SMS hard-cap truncation.
//
// Example-based tests covering the unchanged pass-through, the 4-part cap,
// the `...` indicator budget, end-to-end splitSms behaviour and word
// boundary preference.

import { describe, it, expect } from 'vitest';
import { splitSms } from './index.js';
import { MAX_PARTS, TRUNCATION_INDICATOR } from './limits.js';
import { splitContent } from './split.js';
import { applyHardCap } from './truncation.js';
import { countCodeUnits } from './units.js';

const CONTENT_BUDGET = 147;

// _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
describe('SMS Message Splitter — truncation (unit)', () => {
  it('returns the input unchanged when there are at most 4 parts', () => {
    const parts = ['a', 'b', 'c', 'd'];
    expect(applyHardCap(parts, CONTENT_BUDGET, 'GSM-7')).toEqual(parts);
    expect(applyHardCap(['only'], CONTENT_BUDGET, 'GSM-7')).toEqual(['only']);
  });

  it('caps a 5+ part split at exactly 4 parts, keeping the first 3 and ending with ...', () => {
    const text = 'word '.repeat(200);
    const content = splitContent(text, 'GSM-7');
    expect(content.length).toBeGreaterThan(MAX_PARTS);

    const capped = applyHardCap(content, CONTENT_BUDGET, 'GSM-7');
    expect(capped).toHaveLength(MAX_PARTS);
    expect(capped.slice(0, 3)).toEqual(content.slice(0, 3));
    expect(capped[3]?.endsWith(TRUNCATION_INDICATOR)).toBe(true);
  });

  it('counts the ... indicator toward the last part budget', () => {
    const text = 'a'.repeat(1000);
    const content = splitContent(text, 'GSM-7');
    const capped = applyHardCap(content, CONTENT_BUDGET, 'GSM-7');
    const last = capped[capped.length - 1] as string;
    expect(TRUNCATION_INDICATOR).toHaveLength(3);
    expect(countCodeUnits(last, 'GSM-7')).toBeLessThanOrEqual(CONTENT_BUDGET);
  });

  it('truncates a very long GSM-7 reply to 4 parts within the 153 limit', () => {
    const parts = splitSms('lorem ipsum dolor '.repeat(100));
    expect(parts).toHaveLength(4);
    const last = parts[3] as string;
    expect(last.startsWith('(4/4) ')).toBe(true);
    expect(last.endsWith('...')).toBe(true);
    expect(countCodeUnits(last, 'GSM-7')).toBeLessThanOrEqual(153);
  });

  it('truncates a very long UCS-2 reply to 4 parts within the 67 limit', () => {
    const parts = splitSms('سلام دنیا 😀 '.repeat(100));
    expect(parts).toHaveLength(4);
    const last = parts[3] as string;
    expect(last.startsWith('(4/4) ')).toBe(true);
    expect(last.endsWith('...')).toBe(true);
    expect(countCodeUnits(last, 'UCS-2')).toBeLessThanOrEqual(67);
  });

  it('prefers a word boundary: content before ... ends with a space', () => {
    const text = 'word '.repeat(200);
    const content = splitContent(text, 'GSM-7');
    const capped = applyHardCap(content, CONTENT_BUDGET, 'GSM-7');
    const last = capped[3] as string;
    const body = last.slice(0, -TRUNCATION_INDICATOR.length);
    expect(body.endsWith(' ')).toBe(true);
  });
});
