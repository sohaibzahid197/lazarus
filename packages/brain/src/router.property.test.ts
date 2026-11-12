import fc from 'fast-check';
import { describe, it } from 'vitest';
import { routeCommand } from './router.js';
import { COMMANDS, LANGUAGES } from './router.types.js';
import { anyText, plainLatinWordArb, punctArb } from './router.arbitraries.js';
import { ALIAS_TABLE } from './aliases.js';
import { normalizeMessage } from './normalize.js';

const EXPECTED_KEYS = ['argument', 'argumentMissing', 'command', 'language'];

/** Checks the well-formedness shape of a routing result for the given input. */
function isWellFormed(input: string): boolean {
  const r = routeCommand(input);
  const keys = Object.keys(r).sort();
  if (keys.length !== EXPECTED_KEYS.length) return false;
  if (!keys.every((k, i) => k === EXPECTED_KEYS[i])) return false;
  if (!(COMMANDS as readonly string[]).includes(r.command)) return false;
  if (!(LANGUAGES as readonly string[]).includes(r.language)) return false;
  if (typeof r.argument !== 'string' || typeof r.argumentMissing !== 'boolean') return false;
  if (/^\s*$/.test(input)) {
    return r.command === 'QUESTION' && r.argument === '';
  }
  return true;
}

/** Lone surrogates (high or low, unpaired) mixed with ordinary characters. */
const loneSurrogateArb: fc.Arbitrary<string> = fc.string({
  unit: fc.oneof(
    fc.integer({ min: 0xd800, max: 0xdfff }).map((c) => String.fromCharCode(c)),
    fc.constantFrom('a', ' ', 'stop', '\u{1F600}'),
  ),
  maxLength: 50,
});

/** Astral-plane characters (emoji, math alphanumerics, etc.). */
const astralArb: fc.Arbitrary<string> = fc.string({
  unit: fc.integer({ min: 0x10000, max: 0x10ffff }).map((c) => String.fromCodePoint(c)),
  maxLength: 50,
});

const whitespaceOnlyArb: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '\r', '\u00A0', '\uFEFF', '\u2003'),
  maxLength: 30,
});

describe('routeCommand totality properties', () => {
  // Feature: brain-command-router, Property 1: Routing is total and well-formed
  it('Property 1: Routing is total and well-formed (arbitrary text)', () => {
    // **Validates: Requirements 1.1, 1.2, 1.6, 2.5, 4.7, 7.1, 8.7, 9.1**
    fc.assert(
      fc.property(
        fc.oneof(anyText, loneSurrogateArb, astralArb, whitespaceOnlyArb, fc.constant('')),
        isWellFormed,
      ),
      { numRuns: 200 },
    );
  });

  // Feature: brain-command-router, Property 1: Routing is total and well-formed
  it('Property 1: whitespace-only or empty input gives QUESTION with empty argument', () => {
    // **Validates: Requirements 1.2, 2.5, 4.7**
    fc.assert(
      fc.property(whitespaceOnlyArb, (ws) => {
        const r = routeCommand(ws);
        return r.command === 'QUESTION' && r.argument === '';
      }),
      { numRuns: 200 },
    );
  });

  // Feature: brain-command-router, Property 1: Routing is total and well-formed
  it('Property 1: inputs over 10,000 characters are handled', () => {
    // **Validates: Requirements 8.7**
    fc.assert(
      fc.property(
        fc.string({ minLength: 10001, maxLength: 12000 }),
        fc.string({ minLength: 10001, maxLength: 12000, unit: 'binary' }),
        (a, b) => isWellFormed(a) && isWellFormed(b),
      ),
      { numRuns: 10 },
    );
  });
});

describe('routeCommand determinism properties', () => {
  const aliasArb: fc.Arbitrary<string> = fc.constantFrom(
    'help', 'HELP', 'stop', 'Stop', 'start', 'scam', 'SCAM', 'remind', 'translate', 'TRANSLATE',
  );
  const aliasPrefixedArb: fc.Arbitrary<string> = fc
    .tuple(whitespaceOnlyArb, aliasArb, fc.constantFrom('', ' ', ':', ': ', '\n'), anyText)
    .map(([lead, alias, sep, rest]) => `${lead}${alias}${sep}${rest}`);

  // Feature: brain-command-router, Property 2: Routing is deterministic
  it('Property 2: two calls to routeCommand return deeply equal results', () => {
    // **Validates: Requirements 1.5, 8.2**
    fc.assert(
      fc.property(
        fc.oneof(anyText, aliasPrefixedArb, loneSurrogateArb, astralArb, whitespaceOnlyArb),
        (input) => {
          const first = routeCommand(input);
          const second = routeCommand(input);
          return JSON.stringify(first) === JSON.stringify(second) &&
            first.command === second.command &&
            first.language === second.language &&
            first.argument === second.argument &&
            first.argumentMissing === second.argumentMissing;
        },
      ),
      { numRuns: 200 },
    );
  });
});

/** True when the first token of the normalized text is not an alias after punctuation strip and lowercasing. */
function hasUnknownKeyword(input: string): boolean {
  const text = normalizeMessage(input);
  const space = text.indexOf(' ');
  const token = space === -1 ? text : text.slice(0, space);
  const keyword = token.replace(/[.,!?:;]+$/, '').toLowerCase();
  return !ALIAS_TABLE.has(keyword);
}

describe('routeCommand unknown keyword properties', () => {
  const plainMessageArb: fc.Arbitrary<string> = fc
    .tuple(plainLatinWordArb, punctArb, fc.constantFrom(' ', '  ', '\t', '\n'), anyText)
    .map(([word, punct, sep, tail]) => `${word}${punct}${sep}${tail}`);

  // Feature: brain-command-router, Property 4: Unknown keyword routes to QUESTION
  it('Property 4: unknown first token routes to QUESTION with the normalized message', () => {
    // **Validates: Requirements 1.3, 3.10**
    fc.assert(
      fc.property(
        fc.oneof(anyText, plainMessageArb).filter(hasUnknownKeyword),
        (input) => {
          const r = routeCommand(input);
          return r.command === 'QUESTION' && r.argument === normalizeMessage(input);
        },
      ),
      { numRuns: 200 },
    );
  });
});
