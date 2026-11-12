import fc from 'fast-check';
import { describe, it } from 'vitest';
import { printCommand } from './printer.js';
import { routeCommand } from './router.js';
import { LANGUAGES } from './router.types.js';
import { aliasArb, anyText, caseMutate, punctArb, wsArb } from './router.arbitraries.js';

/** Alias + case mutation + punctuation + optional separator + tail, so non-QUESTION results are common. */
const aliasMessageArb: fc.Arbitrary<string> = aliasArb
  .chain((alias) => caseMutate(alias))
  .chain((kw) =>
    fc.tuple(punctArb, wsArb, anyText, fc.boolean()).map(([punct, ws, tail, withTail]) =>
      withTail ? `${kw}${punct}${ws}${tail}` : `${kw}${punct}`,
    ),
  );

const messageArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: aliasMessageArb },
  { weight: 1, arbitrary: anyText },
);

describe('printCommand properties', () => {
  // Feature: brain-command-router, Property 14: Print/route round trip
  it('Property 14: Print/route round trip', () => {
    // **Validates: Requirements 7.3, 7.4, 7.5**
    fc.assert(
      fc.property(messageArb, (s) => {
        const r = routeCommand(s);
        fc.pre(r.command !== 'QUESTION');
        const printed = printCommand(r);
        const back = routeCommand(printed);
        const sameRoute = back.command === r.command && back.argument === r.argument;
        const noTrailingSpace = r.argument !== '' || !printed.endsWith(' ');
        return sameRoute && noTrailingSpace;
      }),
      { numRuns: 200 },
    );
  });

  // Feature: brain-command-router, Property 15: Printing QUESTION is the identity on the argument
  it('Property 15: Printing QUESTION is the identity on the argument', () => {
    // **Validates: Requirements 7.6**
    fc.assert(
      fc.property(anyText, fc.constantFrom(...LANGUAGES), (argument, language) => {
        return (
          printCommand({ command: 'QUESTION', argument, language, argumentMissing: false }) ===
          argument
        );
      }),
      { numRuns: 200 },
    );
  });
});
