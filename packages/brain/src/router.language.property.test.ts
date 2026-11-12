import fc from 'fast-check';
import { describe, it } from 'vitest';
import { detectLanguage } from './language.js';
import { routeCommand } from './router.js';
import { aliasArb, anyText, markerArb, urduCharArb, wsArb } from './router.arbitraries.js';

/** Messages mixing aliases, markers and Urdu characters with arbitrary text. */
const mixedArb: fc.Arbitrary<string> = fc.oneof(
  anyText,
  fc.tuple(aliasArb, wsArb, anyText).map(([a, ws, t]) => `${a}${ws}${t}`),
  fc.tuple(anyText, wsArb, markerArb, wsArb, anyText).map(([a, w1, m, w2, b]) => `${a}${w1}${m}${w2}${b}`),
  fc.tuple(anyText, urduCharArb, anyText).map(([a, u, b]) => `${a}${u}${b}`),
);

// Feature: brain-command-router, Property 13: Router language matches the detector
describe('Property 13: Router language matches the detector', () => {
  /**
   * **Validates: Requirements 6.8**
   */
  it('routeCommand(s).language equals detectLanguage(s)', () => {
    fc.assert(
      fc.property(mixedArb, (s) => routeCommand(s).language === detectLanguage(s)),
      { numRuns: 200 },
    );
  });
});
