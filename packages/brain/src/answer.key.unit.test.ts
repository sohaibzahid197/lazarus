// Unit tests for buildCacheKey.
// _Requirements: 7.1, 7.5, 7.7_
import { describe, it, expect } from 'vitest';
import { buildCacheKey } from './answer.key.js';

describe('buildCacheKey', () => {
  it('encodes kind, language and folded normalized text as JSON', () => {
    expect(buildCacheKey('question', 'en', '  What IS\tRain? ')).toBe(
      JSON.stringify(['question', 'en', 'what is rain?']),
    );
  });

  it('ignores Latin case and whitespace differences', () => {
    expect(buildCacheKey('question', 'roman-ur', 'Barish  KAB\nhogi')).toBe(
      buildCacheKey('question', 'roman-ur', 'barish kab hogi'),
    );
  });

  it('lower-cases only A-Z', () => {
    expect(buildCacheKey('scam', 'en', 'ÀÉ Ω')).toBe(JSON.stringify(['scam', 'en', 'ÀÉ Ω']));
  });

  it('differs by kind and by language', () => {
    const q = buildCacheKey('question', 'en', 'hello');
    expect(buildCacheKey('scam', 'en', 'hello')).not.toBe(q);
    expect(buildCacheKey('question', 'ur', 'hello')).not.toBe(q);
  });

  it('keeps parts unambiguous when text contains quotes and commas', () => {
    expect(JSON.parse(buildCacheKey('question', 'en', 'a","b'))).toEqual(['question', 'en', 'a","b']);
  });
});
