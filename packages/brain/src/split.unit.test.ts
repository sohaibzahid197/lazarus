// Unit tests for the SMS splitting helpers.
//
// Example-based tests covering single/multi-part boundaries, hard cuts,
// surrogate safety, word-boundary adjustment and part prefixes.

import { describe, it, expect } from 'vitest';
import {
  applyPrefixes,
  applyWordBoundary,
  findCutByBudget,
  splitContent,
} from './split.js';
import { countCodeUnits } from './units.js';
import { joinSms, splitSms } from './index.js';

// _Requirements: 2.2, 2.3, 3.1, 3.2, 6.1, 6.2, 6.3_
describe('SMS Message Splitter — splitting (unit)', () => {
  // --- splitContent: part-count boundaries ------------------------------

  it('keeps exactly 160 GSM-7 units in a single part', () => {
    const text = 'a'.repeat(160);
    expect(splitContent(text, 'GSM-7')).toEqual([text]);
  });

  it('splits 161 GSM-7 units into 2 parts of at most 153 units', () => {
    const text = 'a'.repeat(161);
    const parts = splitContent(text, 'GSM-7');
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(countCodeUnits(part, 'GSM-7')).toBeLessThanOrEqual(153);
    }
    expect(parts.join('')).toBe(text);
  });

  // --- splitContent: hard cut -------------------------------------------

  it('hard-cuts a long word at the content budget without losing characters', () => {
    const text = 'a'.repeat(400);
    const parts = splitContent(text, 'GSM-7');
    expect(parts[0]).toHaveLength(147);
    expect(parts.join('')).toBe(text);
  });

  // --- splitContent: surrogate safety -----------------------------------

  it('never splits an emoji across parts in UCS-2', () => {
    // 60 Urdu letters then an emoji straddling the 61-unit content budget.
    const text = 'ا'.repeat(60) + '😀' + 'ب'.repeat(30);
    const parts = splitContent(text, 'UCS-2');
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      const last = part.charCodeAt(part.length - 1);
      const first = part.charCodeAt(0);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
    }
    expect(parts.join('')).toBe(text);
  });

  // --- regression: final chunk that fits is not word-boundary-cut --------

  it('keeps a fitting final chunk whole so the reply stays within 4 parts', () => {
    // 3 full parts (441) + a 147-unit tail with a space inside the last 15.
    const text = 'a'.repeat(441) + 'a'.repeat(132) + ' ' + 'a'.repeat(14);
    expect(text).toHaveLength(588);

    const content = splitContent(text, 'GSM-7');
    expect(content).toHaveLength(4);
    expect(content.join('')).toBe(text);

    const sms = splitSms(text);
    expect(sms).toHaveLength(4);
    for (const part of sms) {
      expect(part).not.toContain('...');
    }
    expect(joinSms(sms)).toBe(text);
  });

  // --- findCutByBudget --------------------------------------------------

  it('counts GSM-7 extension characters as 2 against the budget', () => {
    expect(findCutByBudget('^^^', 3, 'GSM-7')).toBe(1);
  });

  it('moves a surrogate pair to the next part when the cut lands inside it', () => {
    expect(findCutByBudget('ab😀', 3, 'UCS-2')).toBe(2);
  });

  // --- applyWordBoundary ------------------------------------------------

  it('cuts just after a space found in the last 15 code units', () => {
    const text = 'a'.repeat(20) + ' ' + 'a'.repeat(20);
    expect(applyWordBoundary(text, 30)).toBe(21);
  });

  it('returns the hard cut when there is no space in the window', () => {
    expect(applyWordBoundary('a'.repeat(40), 30)).toBe(30);
    const farSpace = 'aaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(applyWordBoundary(farSpace, 30)).toBe(30);
  });

  // --- applyPrefixes ----------------------------------------------------

  it('leaves a single part unchanged', () => {
    expect(applyPrefixes(['hello'])).toEqual(['hello']);
  });

  it('prefixes two parts with (1/2) and (2/2)', () => {
    expect(applyPrefixes(['a', 'b'])).toEqual(['(1/2) a', '(2/2) b']);
  });
});
