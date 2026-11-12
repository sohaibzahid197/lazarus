import fc from 'fast-check';
import { describe, it } from 'vitest';
import { ROMAN_URDU_MARKERS, detectLanguage } from './language.js';
import { ROMAN_URDU_ALIASES } from './aliases.js';
import {
  anyText,
  caseMutate,
  markerArb,
  plainLatinWordArb,
  punctArb,
  urduCharArb,
  wsArb,
} from './router.arbitraries.js';

const romanAliasArb: fc.Arbitrary<string> = fc.constantFrom(...ROMAN_URDU_ALIASES);

describe('detectLanguage properties', () => {
  // Feature: brain-command-router, Property 9: Urdu script implies ur
  it('Property 9: Urdu script implies ur', () => {
    // **Validates: Requirements 6.1**
    fc.assert(
      fc.property(anyText, urduCharArb, anyText, (before, urdu, after) => {
        return detectLanguage(`${before}${urdu}${after}`) === 'ur';
      }),
      { numRuns: 200 },
    );
  });

  // Feature: brain-command-router, Property 9: Urdu script implies ur
  it('Property 9: Urdu-only strings are ur', () => {
    // **Validates: Requirements 6.1**
    fc.assert(
      fc.property(
        fc.array(urduCharArb, { minLength: 1, maxLength: 20 }),
        (chars) => detectLanguage(chars.join('')) === 'ur',
      ),
      { numRuns: 100 },
    );
  });
  // Feature: brain-command-router, Property 10: Roman Urdu markers imply roman-ur
  it('Property 10: a marker as a whole word among plain Latin words is roman-ur', () => {
    // **Validates: Requirements 6.2, 6.6**
    fc.assert(
      fc.property(
        fc.array(plainLatinWordArb, { maxLength: 5 }),
        fc.array(plainLatinWordArb, { maxLength: 5 }),
        markerArb.chain((m) => caseMutate(m)),
        punctArb,
        punctArb,
        wsArb,
        (before, after, marker, lead, trail, ws) => {
          const text = [...before, `${lead}${marker}${trail}`, ...after].join(ws);
          return detectLanguage(text) === 'roman-ur';
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: brain-command-router, Property 10: Roman Urdu markers imply roman-ur
  it('Property 10: a Roman Urdu alias as first word is roman-ur', () => {
    // **Validates: Requirements 6.5, 6.6**
    fc.assert(
      fc.property(
        wsArb,
        romanAliasArb.chain((a) => caseMutate(a)),
        punctArb,
        fc.array(plainLatinWordArb, { maxLength: 5 }),
        (lead, alias, trail, rest) => {
          const text = `${lead}${[`${alias}${trail}`, ...rest].join(' ')}`;
          return detectLanguage(text) === 'roman-ur';
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: brain-command-router, Property 11: No Urdu and no marker implies en
  it('Property 11: plain Latin words only are en', () => {
    // **Validates: Requirements 6.3**
    fc.assert(
      fc.property(
        fc.array(plainLatinWordArb, { maxLength: 8 }),
        wsArb,
        wsArb,
        (words, ws, lead) => detectLanguage(`${lead}${words.join(ws)}`) === 'en',
      ),
      { numRuns: 200 },
    );
  });

  // Feature: brain-command-router, Property 11: No Urdu and no marker implies en
  it('Property 11: whitespace-only strings are en', () => {
    // **Validates: Requirements 6.4**
    fc.assert(
      fc.property(wsArb, (ws) => detectLanguage(ws) === 'en'),
      { numRuns: 100 },
    );
    fc.assert(
      fc.property(fc.constant(''), (s) => detectLanguage(s) === 'en'),
      { numRuns: 100 },
    );
  });

  // Feature: brain-command-router, Property 11: No Urdu and no marker implies en
  it('Property 11: a marker inside a longer word does not count', () => {
    // **Validates: Requirements 6.7**
    const embeddedArb: fc.Arbitrary<string> = fc
      .tuple(plainLatinWordArb, markerArb, plainLatinWordArb)
      .map(([pre, marker, post]) => `${pre}${marker}${post}`)
      .filter((w) => !ROMAN_URDU_MARKERS.has(w) && !ROMAN_URDU_ALIASES.has(w));
    fc.assert(
      fc.property(
        fc.array(embeddedArb, { minLength: 1, maxLength: 5 }),
        wsArb,
        (words, ws) => detectLanguage(words.join(ws)) === 'en',
      ),
      { numRuns: 200 },
    );
  });

  // Feature: brain-command-router, Property 12: Language detection is total and deterministic
  it('Property 12: detectLanguage is total and deterministic', () => {
    // **Validates: Requirements 6.9, 9.3**
    fc.assert(
      fc.property(anyText, (text) => {
        const first = detectLanguage(text);
        const second = detectLanguage(text);
        return (first === 'en' || first === 'ur' || first === 'roman-ur') && first === second;
      }),
      { numRuns: 200 },
    );
  });
});
