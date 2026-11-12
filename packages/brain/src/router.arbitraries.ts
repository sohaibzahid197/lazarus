import fc from 'fast-check';
import { ALIAS_TABLE } from './aliases.js';

/**
 * Roman Urdu marker list from the brain-command-router design.
 * Kept local so these arbitraries do not depend on language.ts.
 */
const MARKERS: readonly string[] = [
  'kya', 'hai', 'hain', 'mein', 'main', 'kaise', 'kaisa', 'nahi', 'nahin',
  'aap', 'meri', 'mera', 'mere', 'karo', 'kar', 'ka', 'ki', 'ke', 'ko',
  'se', 'ho', 'hoga', 'chahiye', 'kab', 'kahan', 'kyun', 'kitna', 'bhai',
  'shukriya', 'acha',
];

const ALIASES: readonly string[] = [...ALIAS_TABLE.keys()];

const EXCLUDED_WORDS: ReadonlySet<string> = new Set([...MARKERS, ...ALIASES]);

/** Arbitrary text: ASCII-ish, full Unicode (incl. lone surrogates) and whitespace-only. */
export const anyText: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 1000 }),
  fc.string({ maxLength: 1000, unit: 'binary' }),
  fc.string({ unit: fc.constantFrom(' ', '\t', '\n', '\u00A0') }),
);

/** Any key of the alias table (English, Roman Urdu, Urdu script). */
export const aliasArb: fc.Arbitrary<string> = fc.constantFrom(...ALIASES);

/** Per-character random upper/lower casing of a string. */
export function caseMutate(alias: string): fc.Arbitrary<string> {
  const chars = Array.from(alias);
  if (chars.length === 0) return fc.constant('');
  return fc
    .array(fc.boolean(), { minLength: chars.length, maxLength: chars.length })
    .map((flags) =>
      chars.map((c, i) => (flags[i] === true ? c.toUpperCase() : c.toLowerCase())).join(''),
    );
}

/** Zero to three trailing punctuation characters the router strips. */
export const punctArb: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom('.', ',', '!', '?', ':', ';'),
  maxLength: 3,
});

/** Non-empty whitespace separator. */
export const wsArb: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '\r'),
  minLength: 1,
  maxLength: 5,
});

const URDU_RANGES: readonly (readonly [number, number])[] = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0xfb50, 0xfdff],
  // U+FEFF is excluded: it is whitespace/BOM, not an Urdu letter.
  [0xfe70, 0xfefe],
];

/** A single Urdu script character from the supported ranges. */
export const urduCharArb: fc.Arbitrary<string> = fc
  .constantFrom(...URDU_RANGES)
  .chain(([lo, hi]) => fc.integer({ min: lo, max: hi }))
  .map((code) => String.fromCharCode(code));

/** A Roman Urdu marker word. */
export const markerArb: fc.Arbitrary<string> = fc.constantFrom(...MARKERS);

/** Lowercase Latin word that is neither a marker nor an alias. */
export const plainLatinWordArb: fc.Arbitrary<string> = fc
  .string({
    unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    minLength: 1,
    maxLength: 10,
  })
  .filter((w) => !EXCLUDED_WORDS.has(w));
