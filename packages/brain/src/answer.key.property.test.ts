// Property-based tests for the Cache_Key builder (`answer.key.ts`).
//
// Runs at least 100 fast-check iterations (PBT_OPTIONS).
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildCacheKey } from './answer.key.js';
import type { RequestKind } from './answer.types.js';
import {
  PBT_OPTIONS,
  anyInputTextArb,
  languageArb,
  whitespaceVariantPairArb,
} from './answer.arbitraries.js';

const kindArb: fc.Arbitrary<RequestKind> = fc.constantFrom<RequestKind>('question', 'scam');

describe('buildCacheKey properties', () => {
  // Feature: ai-answer-service, Property 11: Cache keys ignore case and whitespace
  // **Validates: Requirements 7.1, 7.5, 13.3**
  it('Property 11: variants differing only in Latin case and whitespace share a key', () => {
    fc.assert(
      fc.property(kindArb, languageArb, whitespaceVariantPairArb, (kind, language, [a, b]) => {
        expect(buildCacheKey(kind, language, a)).toBe(buildCacheKey(kind, language, b));
      }),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 11: Cache keys ignore case and whitespace
  // **Validates: Requirements 7.1, 7.5, 13.3**
  it('Property 11: keys differ when the kind or the Language differs', () => {
    fc.assert(
      fc.property(
        kindArb,
        languageArb,
        kindArb,
        languageArb,
        anyInputTextArb,
        (kindA, langA, kindB, langB, text) => {
          fc.pre(kindA !== kindB || langA !== langB);
          expect(buildCacheKey(kindA, langA, text)).not.toBe(buildCacheKey(kindB, langB, text));
        },
      ),
      PBT_OPTIONS,
    );
  });
});
