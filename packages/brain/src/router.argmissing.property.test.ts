import fc from 'fast-check';
import { describe, it } from 'vitest';
import { routeCommand } from './router.js';
import { aliasArb, anyText, caseMutate, punctArb, wsArb } from './router.arbitraries.js';

const ARG_REQUIRED: ReadonlySet<string> = new Set(['SCAM', 'REMIND', 'TRANSLATE']);

/** Alias-prefixed message with optional whitespace + tail (tail may be whitespace-only or empty). */
const aliasMessage: fc.Arbitrary<string> = fc
  .tuple(
    aliasArb.chain((alias) => caseMutate(alias)),
    punctArb,
    fc.option(
      fc.tuple(
        wsArb,
        fc.oneof(
          fc.string({ maxLength: 100 }),
          fc.string({ unit: fc.constantFrom(' ', '\t', '\n', '\r', '\u00A0'), maxLength: 5 }),
        ),
      ),
      { nil: undefined },
    ),
  )
  .map(([kw, punct, rest]) => (rest === undefined ? `${kw}${punct}` : `${kw}${punct}${rest[0]}${rest[1]}`));

// Feature: brain-command-router, Property 7: argumentMissing reflects empty required arguments
describe('Property 7: argumentMissing reflects empty required arguments', () => {
  /**
   * **Validates: Requirements 5.4, 5.5, 5.6**
   */
  it('argumentMissing is true iff command is SCAM/REMIND/TRANSLATE and argument is empty', () => {
    fc.assert(
      fc.property(fc.oneof(anyText, aliasMessage), (input) => {
        const r = routeCommand(input);
        return r.argumentMissing === (ARG_REQUIRED.has(r.command) && r.argument === '');
      }),
      { numRuns: 200 },
    );
  });
});
