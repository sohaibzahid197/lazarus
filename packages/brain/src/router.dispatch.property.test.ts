import fc from 'fast-check';
import { describe, it } from 'vitest';
import { ALIAS_TABLE } from './aliases.js';
import { normalizeMessage } from './normalize.js';
import { routeCommand } from './router.js';
import { aliasArb, caseMutate, punctArb, wsArb } from './router.arbitraries.js';

// Feature: brain-command-router, Property 3: Alias dispatch with tolerant formatting
describe('Property 3: Alias dispatch with tolerant formatting', () => {
  /**
   * **Validates: Requirements 1.4, 2.1, 2.2, 2.3, 2.4, 2.6, 3.1, 3.9, 5.1, 5.2, 5.3, 5.7**
   */
  it('routes alias + punctuation + whitespace + tail to the mapped command and normalized tail', () => {
    fc.assert(
      fc.property(
        aliasArb.chain((alias) => fc.tuple(fc.constant(alias), caseMutate(alias))),
        punctArb,
        wsArb,
        fc.oneof(fc.string({ maxLength: 200 }), fc.string({ unit: 'binary', maxLength: 200 })),
        ([alias, mutated], punct, ws, tail) => {
          const result = routeCommand(`${mutated}${punct}${ws}${tail}`);
          return (
            result.command === ALIAS_TABLE.get(alias) &&
            result.argument === normalizeMessage(tail)
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.4, 5.1, 5.4**
   */
  it('gives an empty argument when only alias + punctuation (+ optional whitespace) is sent', () => {
    fc.assert(
      fc.property(
        aliasArb.chain((alias) => fc.tuple(fc.constant(alias), caseMutate(alias))),
        punctArb,
        fc.oneof(fc.constant(''), wsArb),
        ([alias, mutated], punct, ws) => {
          const result = routeCommand(`${mutated}${punct}${ws}`);
          return result.command === ALIAS_TABLE.get(alias) && result.argument === '';
        },
      ),
      { numRuns: 200 },
    );
  });
});
