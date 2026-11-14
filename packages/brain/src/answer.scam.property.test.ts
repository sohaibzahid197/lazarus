// Property-based tests for the Scam_Parser and Scam_Printer (`answer.scam.ts`).
//
// Runs at least 100 fast-check iterations (PBT_OPTIONS).
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseScam, printScam } from './answer.scam.js';
import { FIXED_TEXTS, MAX_REASON_CODE_POINTS } from './answer.texts.js';
import type { Language, ScamResult, ScamVerdict } from './answer.types.js';
import { normalizeMessage } from './normalize.js';
import {
  PBT_OPTIONS,
  anyInputTextArb,
  languageArb,
  mixedScriptText,
  modelOutputArb,
  scamResultArb,
  scamVerdictArb,
} from './answer.arbitraries.js';

const VERDICTS: readonly ScamVerdict[] = ['SCAM', 'SAFE', 'UNSURE'];

/** Every verdict key `parseScam` must accept for `language`: canonical and localized. */
function knownVerdictKeys(language: Language): readonly string[] {
  const localized = FIXED_TEXTS[language].scamWord;
  return VERDICTS.flatMap((v) => [v, normalizeMessage(localized[v]).toUpperCase()]);
}

/** Blank lines (spaces and tabs only) placed before the first non-blank line. */
const blankLinesArb: fc.Arbitrary<string> = fc
  .array(fc.string({ unit: fc.constantFrom(' ', '\t', '\u00A0'), maxLength: 3 }), {
    maxLength: 3,
  })
  .chain((lines) =>
    fc.constantFrom('\n', '\r\n', '\r').map((sep) => lines.map((l) => l + sep).join('')),
  );

/** Text on one line: no line breaks. */
const oneLine = (maxLength: number): fc.Arbitrary<string> =>
  mixedScriptText({ maxLength }).map((t) => t.replace(/[\n\r]/g, ' '));

/** Optional rest of the output after the first non-blank line. */
const restArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  modelOutputArb.map((t) => '\n' + t),
);

/** Spaces or tabs around a verdict word. */
const padArb: fc.Arbitrary<string> = fc.string({ unit: fc.constantFrom(' ', '\t'), maxLength: 2 });

/** A Reason part that is empty or whitespace only. */
const blankReasonArb: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(' ', '\t', '\u00A0'),
  maxLength: 4,
});

/** A known verdict word for `language` (canonical or localized), in random Latin case. */
function knownWordArb(language: Language): fc.Arbitrary<{ verdict: ScamVerdict; word: string }> {
  return fc
    .tuple(scamVerdictArb, fc.boolean(), fc.constantFrom('upper', 'lower', 'as-is'), padArb, padArb)
    .map(([verdict, canonical, casing, lead, trail]) => {
      const base = canonical ? verdict : FIXED_TEXTS[language].scamWord[verdict];
      const cased =
        casing === 'upper' ? base.toUpperCase() : casing === 'lower' ? base.toLowerCase() : base;
      return { verdict, word: lead + cased + trail };
    });
}

/** A non-blank verdict word, without a colon, that is not a known verdict for `language`. */
function unknownWordArb(language: Language): fc.Arbitrary<string> {
  const known = knownVerdictKeys(language);
  return oneLine(15).filter(
    (w) =>
      w.trim() !== '' && !w.includes(':') && !known.includes(normalizeMessage(w).toUpperCase()),
  );
}

interface Case {
  readonly language: Language;
  readonly output: string;
  /** Exact result required by the spec, when the case pins it down. */
  readonly expected?: ScamResult;
  /** Verdict required by the spec, when only the verdict is pinned down. */
  readonly expectedVerdict?: ScamVerdict;
}

/** Arbitrary model output: no expectation beyond the general invariants. */
const freeCaseArb: fc.Arbitrary<Case> = fc
  .tuple(languageArb, fc.oneof(modelOutputArb, anyInputTextArb))
  .map(([language, output]) => ({ language, output }));

/** First non-blank line has no colon: UNSURE with the unparseable Reason (9.5). */
const noColonCaseArb: fc.Arbitrary<Case> = languageArb.chain((language) =>
  fc
    .tuple(
      blankLinesArb,
      oneLine(80).filter((l) => l.trim() !== '' && !l.includes(':')),
      restArb,
    )
    .map(([blank, line, rest]) => ({
      language,
      output: blank + line + rest,
      expected: { verdict: 'UNSURE', reason: FIXED_TEXTS[language].scamReason.unparseable },
    })),
);

/** Blank or whitespace-only output: UNSURE with the unparseable Reason (9.5). */
const blankOutputCaseArb: fc.Arbitrary<Case> = fc
  .tuple(languageArb, blankLinesArb, blankReasonArb)
  .map(([language, blank, tail]) => ({
    language,
    output: blank + tail,
    expected: { verdict: 'UNSURE', reason: FIXED_TEXTS[language].scamReason.unparseable },
  }));

/** Unknown verdict word with any Reason: verdict UNSURE (9.6). */
const unknownWordCaseArb: fc.Arbitrary<Case> = languageArb.chain((language) =>
  fc
    .tuple(blankLinesArb, unknownWordArb(language), oneLine(150), restArb)
    .map(([blank, word, reason, rest]) => ({
      language,
      output: `${blank}${word}:${reason}${rest}`,
      expectedVerdict: 'UNSURE' as const,
    })),
);

/** Known or unknown verdict word with a blank Reason: the fixed Reason for the verdict (9.7). */
const blankReasonCaseArb: fc.Arbitrary<Case> = languageArb.chain((language) =>
  fc
    .tuple(
      blankLinesArb,
      fc.oneof(
        knownWordArb(language),
        unknownWordArb(language).map((word) => ({ verdict: 'UNSURE' as const, word })),
      ),
      blankReasonArb,
      restArb,
    )
    .map(([blank, { verdict, word }, reason, rest]) => ({
      language,
      output: `${blank}${word}:${reason}${rest}`,
      expected: { verdict, reason: FIXED_TEXTS[language].scamReason[verdict] },
    })),
);

/** Known verdict word with any Reason: that verdict is kept. */
const knownWordCaseArb: fc.Arbitrary<Case> = languageArb.chain((language) =>
  fc
    .tuple(blankLinesArb, knownWordArb(language), oneLine(150), restArb)
    .map(([blank, { verdict, word }, reason, rest]) => ({
      language,
      output: `${blank}${word}:${reason}${rest}`,
      expectedVerdict: verdict,
    })),
);

const caseArb: fc.Arbitrary<Case> = fc.oneof(
  freeCaseArb,
  noColonCaseArb,
  blankOutputCaseArb,
  unknownWordCaseArb,
  blankReasonCaseArb,
  knownWordCaseArb,
);

describe('parseScam and printScam properties', () => {
  // Feature: ai-answer-service, Property 18: Scam printing and parsing round trip
  // **Validates: Requirements 9.2, 9.12, 13.4**
  it('Property 18: parseScam(printScam(r)) equals r for every valid result and Language', () => {
    fc.assert(
      fc.property(languageArb, scamResultArb, (language, result) => {
        const printed = printScam(result, language);
        expect(printed).toBe(`${FIXED_TEXTS[language].scamWord[result.verdict]}: ${result.reason}`);
        expect(parseScam(printed, language)).toEqual(result);
      }),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 19: The scam parser is total and defaults to UNSURE
  // **Validates: Requirements 9.5, 9.6, 9.7**
  it('Property 19: parseScam is total, gives a valid Reason and defaults to UNSURE', () => {
    fc.assert(
      fc.property(caseArb, ({ language, output, expected, expectedVerdict }) => {
        let result: ScamResult | undefined;
        expect(() => {
          result = parseScam(output, language);
        }).not.toThrow();
        if (result === undefined) throw new Error('parseScam returned nothing');

        expect(VERDICTS).toContain(result.verdict);
        expect(result.reason.trim()).not.toBe('');
        expect(result.reason).not.toMatch(/[\n\r]/);
        expect(Array.from(result.reason).length).toBeLessThanOrEqual(MAX_REASON_CODE_POINTS);
        expect(normalizeMessage(result.reason)).toBe(result.reason);

        if (expected !== undefined) expect(result).toEqual(expected);
        if (expectedVerdict !== undefined) expect(result.verdict).toBe(expectedVerdict);
      }),
      PBT_OPTIONS,
    );
  });
});
