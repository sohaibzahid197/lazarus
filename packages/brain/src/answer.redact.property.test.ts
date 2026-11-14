// Property-based tests for the redactor (`answer.redact.ts`).
//
// Each property runs at least 100 fast-check iterations (PBT_OPTIONS) and is
// tagged with its design property number and the requirements it validates.
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { maskPhoneNumbers, redactSecrets } from './answer.redact.js';
import { REDACTED } from './answer.texts.js';
import {
  PBT_OPTIONS,
  anyInputTextArb,
  mixedScriptText,
  phoneLikeRunArb,
  secretArb,
  secretsArb,
  shortDigitRunArb,
  type DigitRun,
} from './answer.arbitraries.js';

const MAX_TEXT_LENGTH = 5000;

/** Base text of 0 to 5,000 characters: short mixed text or a long one. */
const baseTextArb: fc.Arbitrary<string> = fc.oneof(
  anyInputTextArb,
  mixedScriptText({ minLength: 1000, maxLength: 4000 }),
);

/**
 * Secrets list that may also hold a Secret overlapping another one
 * (suffix of one is the prefix of the other) and empty strings to ignore.
 */
const secretListArb: fc.Arbitrary<readonly string[]> = fc
  .tuple(secretsArb, fc.option(fc.tuple(fc.nat(), secretArb)), fc.boolean())
  .map(([secrets, overlap, withEmpty]) => {
    const list = [...secrets];
    const base = secrets[0];
    if (overlap !== null && base !== undefined) {
      const [cutSeed, tail] = overlap;
      const derived = base.slice(cutSeed % base.length) + tail;
      if (!derived.includes('[') && !derived.includes(']') && !REDACTED.includes(derived)) {
        list.push(derived);
      }
    }
    if (withEmpty) list.push('');
    return list;
  });

interface Insertion {
  readonly secretSeed: number;
  readonly positionSeed: number;
  /** 0 inserts the Secret once; otherwise the Secret plus a self-overlapping tail. */
  readonly overlapSeed: number;
}

const insertionArb: fc.Arbitrary<Insertion> = fc.record({
  secretSeed: fc.nat(),
  positionSeed: fc.nat(),
  overlapSeed: fc.nat({ max: 3 }),
});

/** The piece to insert: the Secret, or the Secret overlapped with itself (e.g. `abab` + `ab`). */
function piece(secret: string, overlapSeed: number): string {
  if (overlapSeed === 0 || secret.length < 2) return secret;
  return secret + secret.slice(1 + (overlapSeed % (secret.length - 1)));
}

/** Inserts Secrets at arbitrary positions, possibly inside earlier insertions. */
function insertSecrets(
  text: string,
  secrets: readonly string[],
  insertions: readonly Insertion[],
): string {
  const usable = secrets.filter((s) => s !== '');
  if (usable.length === 0) return text;
  let out = text;
  for (const { secretSeed, positionSeed, overlapSeed } of insertions) {
    const secret = usable[secretSeed % usable.length] ?? '';
    const at = positionSeed % (out.length + 1);
    out = out.slice(0, at) + piece(secret, overlapSeed) + out.slice(at);
  }
  return out.slice(0, MAX_TEXT_LENGTH);
}

const textWithSecretsArb = fc
  .tuple(baseTextArb, secretListArb, fc.array(insertionArb, { maxLength: 12 }))
  .map(([base, secrets, insertions]) => ({
    secrets,
    text: insertSecrets(base, secrets, insertions),
  }));

describe('AI Answer Service — Redactor', () => {
  // Feature: ai-answer-service, Property 25: Redaction removes every secret
  // Validates: Requirements 10.2, 10.3, 13.6
  describe('Property 25: Redaction removes every secret', () => {
    it('output contains no non-empty Secret, even with repeated and overlapping insertions', () => {
      fc.assert(
        fc.property(textWithSecretsArb, ({ text, secrets }) => {
          const out = redactSecrets(text, secrets);
          for (const secret of secrets) {
            if (secret !== '') expect(out.includes(secret)).toBe(false);
          }
        }),
        PBT_OPTIONS,
      );
    });

    it('empty or all-empty secret list returns the input unchanged', () => {
      fc.assert(
        fc.property(
          baseTextArb,
          fc.array(fc.constant(''), { maxLength: 4 }),
          (text, secrets) => {
            expect(redactSecrets(text, secrets)).toBe(text);
          },
        ),
        PBT_OPTIONS,
      );
    });
  });
});

/**
 * Text between digit runs. It never holds a digit, `+`, space or hyphen, so a
 * neighbouring separator cannot extend or merge a run.
 */
const runSeparatorArb: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom('a', 'Z', '.', ',', ':', '(', ')', '/', '\n', 'ب', 'ک', '۔', '؟'),
  minLength: 1,
  maxLength: 4,
});

/** Runs interleaved with separators: `sep run sep run ... sep`. */
function embedRuns(
  runs: readonly DigitRun[],
  separators: readonly string[],
  render: (run: DigitRun) => string,
): string {
  return runs.reduce(
    (out, run, i) => out + render(run) + (separators[i + 1] ?? '.'),
    separators[0] ?? '.',
  );
}

/** The run with every digit except the last 3 replaced by `*`. */
function expectedMask({ run, digits }: DigitRun): string {
  let digitIndex = 0;
  let out = '';
  for (const ch of run) {
    if (ch >= '0' && ch <= '9') {
      out += digitIndex < digits.length - 3 ? '*' : ch;
      digitIndex += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

const separatorsFor = (count: number): fc.Arbitrary<string[]> =>
  fc.array(runSeparatorArb, { minLength: count + 1, maxLength: count + 1 });

const embeddedPhoneRunsArb = fc
  .array(phoneLikeRunArb, { minLength: 1, maxLength: 4 })
  .chain((runs) => fc.tuple(fc.constant(runs), separatorsFor(runs.length)));

const embeddedShortRunsArb = fc
  .array(shortDigitRunArb, { minLength: 1, maxLength: 6 })
  .chain((runs) => fc.tuple(fc.constant(runs), separatorsFor(runs.length)));

describe('AI Answer Service — Phone-number masking', () => {
  // Feature: ai-answer-service, Property 26: Phone-number masking keeps the last 3 digits
  // Validates: Requirements 10.5, 10.6
  describe('Property 26: Phone-number masking keeps the last 3 digits', () => {
    it('runs of 7+ digits keep length, `+`, spaces, hyphens and the last 3 digits', () => {
      fc.assert(
        fc.property(embeddedPhoneRunsArb, ([runs, separators]) => {
          const text = embedRuns(runs, separators, (r) => r.run);
          const out = maskPhoneNumbers(text);
          expect(out).toBe(embedRuns(runs, separators, expectedMask));
          expect(out.length).toBe(text.length);
          const keptDigits = runs.map(({ digits }) => digits.slice(-3)).join('');
          expect(out.replace(/\D/g, '')).toBe(keptDigits);
        }),
        PBT_OPTIONS,
      );
    });

    it('runs of 6 or fewer digits are unchanged', () => {
      fc.assert(
        fc.property(embeddedShortRunsArb, ([runs, separators]) => {
          const text = embedRuns(runs, separators, (r) => r.run);
          expect(maskPhoneNumbers(text)).toBe(text);
        }),
        PBT_OPTIONS,
      );
    });
  });
});
