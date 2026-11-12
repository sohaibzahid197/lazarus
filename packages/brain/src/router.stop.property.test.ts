import fc from 'fast-check';
import { describe, it } from 'vitest';
import { routeCommand } from './router.js';
import { anyText, caseMutate, plainLatinWordArb, punctArb, wsArb } from './router.arbitraries.js';

const STOP_ALIASES = ['stop', 'band', 'بند'] as const;
const OTHER_KEYWORDS = [
  'help', 'scam', 'remind', 'translate', 'start', 'madad', 'shuru', 'dhoka', 'yaad', 'tarjuma',
  'مدد', 'شروع', 'HELP', 'START',
] as const;

const stopAliasArb: fc.Arbitrary<string> = fc
  .constantFrom(...STOP_ALIASES)
  .chain((alias) => caseMutate(alias));

const leadingWsArb: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '\r', '\u00A0'),
  minLength: 0,
  maxLength: 20,
});

/** Tails: random text, binary text, or a run of other command keywords (all up to 1,600 chars). */
const tailArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 1600 }),
  fc.string({ unit: 'binary', maxLength: 800 }),
  fc
    .array(fc.constantFrom(...OTHER_KEYWORDS), { minLength: 0, maxLength: 200 })
    .map((words) => words.join(' ').slice(0, 1600)),
);

// Feature: brain-command-router, Property 5: STOP always wins
describe('Property 5: STOP always wins', () => {
  /**
   * **Validates: Requirements 3.11, 4.1, 4.2, 4.3, 4.4, 9.2**
   */
  it('routes any STOP alias with leading whitespace and any whitespace-separated tail to STOP', () => {
    fc.assert(
      fc.property(leadingWsArb, stopAliasArb, wsArb, tailArb, (lead, alias, ws, tail) => {
        return routeCommand(`${lead}${alias}${ws}${tail}`).command === 'STOP';
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.11, 4.1, 4.2, 4.3, 4.4, 9.2**
   */
  it('routes a STOP alias with trailing punctuation, with or without a tail, to STOP', () => {
    fc.assert(
      fc.property(
        leadingWsArb,
        stopAliasArb,
        punctArb,
        fc.oneof(fc.constant(''), wsArb),
        tailArb,
        (lead, alias, punct, ws, tail) => {
          const text = ws === '' ? `${lead}${alias}${punct}` : `${lead}${alias}${punct}${ws}${tail}`;
          return routeCommand(text).command === 'STOP';
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: brain-command-router, Property 6: A non-leading stop does not trigger STOP
describe('Property 6: A non-leading stop does not trigger STOP', () => {
  /**
   * **Validates: Requirements 4.5**
   */
  it('does not route to STOP when stop appears only after a non-alias first token', () => {
    fc.assert(
      fc.property(plainLatinWordArb, anyText, anyText, (first, before, after) => {
        return routeCommand(`${first} ${before} stop ${after}`).command !== 'STOP';
      }),
      { numRuns: 200 },
    );
  });
});
