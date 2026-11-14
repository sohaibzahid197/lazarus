// Sanity checks for the shared generators: sampled values meet the
// constraints the property tests rely on.
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PBT_OPTIONS,
  blankTextArb,
  clientScript,
  modelOutputArb,
  phoneLikeRunArb,
  scamResultArb,
  secretArb,
  shortDigitRunArb,
  topicQuestionArb,
  whitespaceVariantPairArb,
} from './answer.arbitraries.js';
import { REDACTED } from './answer.texts.js';
import { normalizeMessage } from './normalize.js';

const SAMPLE = { numRuns: 200, seed: 42 } as const;
const foldLatin = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

describe('answer arbitraries', () => {
  it('runs properties at least 100 times', () => {
    expect(PBT_OPTIONS.numRuns).toBeGreaterThanOrEqual(100);
  });

  it('secrets are non-empty, bracket-free and not inside [redacted]', () => {
    for (const s of fc.sample(secretArb, SAMPLE)) {
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toMatch(/[[\]]/);
      expect(REDACTED.includes(s)).toBe(false);
    }
  });

  it('scam results are valid', () => {
    for (const r of fc.sample(scamResultArb, SAMPLE)) {
      expect(['SCAM', 'SAFE', 'UNSURE']).toContain(r.verdict);
      expect(r.reason.length).toBeGreaterThan(0);
      expect(normalizeMessage(r.reason)).toBe(r.reason);
      expect(r.reason).not.toMatch(/[\n\r]/);
      expect(Array.from(r.reason).length).toBeLessThanOrEqual(120);
    }
  });

  it('whitespace variants normalize to the same text', () => {
    for (const [a, b] of fc.sample(whitespaceVariantPairArb, SAMPLE)) {
      expect(foldLatin(normalizeMessage(a))).toBe(foldLatin(normalizeMessage(b)));
    }
  });

  it('blank text is empty or whitespace only', () => {
    for (const t of fc.sample(blankTextArb, SAMPLE)) expect(t.trim()).toBe('');
  });

  it('keyword questions contain the keyword, ignoring Latin case', () => {
    for (const q of fc.sample(topicQuestionArb, SAMPLE)) {
      expect(q.question.toLowerCase()).toContain(q.keyword);
    }
  });

  it('phone-like runs have 7+ digits and short runs 1 to 6', () => {
    for (const { run, digits } of fc.sample(phoneLikeRunArb, SAMPLE)) {
      expect(run).toMatch(/^\+?\d(?:[ -]*\d)*$/);
      expect(run.replace(/\D/g, '')).toBe(digits);
      expect(digits.length).toBeGreaterThanOrEqual(7);
    }
    for (const { run, digits } of fc.sample(shortDigitRunArb, SAMPLE)) {
      expect(run.replace(/\D/g, '')).toBe(digits);
      expect(digits.length).toBeLessThanOrEqual(6);
    }
  });

  it('model outputs stay within 5,000 characters and client scripts hold 1 to 4 steps', () => {
    for (const t of fc.sample(modelOutputArb, SAMPLE)) {
      expect(Array.from(t).length).toBeLessThanOrEqual(5000);
    }
    for (const s of fc.sample(clientScript(), SAMPLE)) {
      expect(s.length).toBeGreaterThanOrEqual(1);
      expect(s.length).toBeLessThanOrEqual(4);
    }
    expect(fc.sample(clientScript(), SAMPLE).flat().some((step) => 'hang' in step)).toBe(false);
  });
});
