// Property tests for the Answer_Service text helpers (answer.text.ts).
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PBT_OPTIONS, mixedScriptText, modelOutputArb } from './answer.arbitraries.js';
import { fitsSms, joinReply, shortenToFit, stripMarkdown } from './answer.text.js';
import { FIXED_TEXTS } from './answer.texts.js';
import { normalizeMessage } from './normalize.js';
import { isHighSurrogate } from './units.js';

/** Every Professional_Referral and Uncertainty_Note in every Language, plus no suffix. */
const FIXED_SUFFIXES: readonly string[] = [
  '',
  ...Object.values(FIXED_TEXTS).flatMap((texts) => [
    texts.uncertainty,
    ...Object.values(texts.referral),
  ]),
];

const suffixArb: fc.Arbitrary<string> = fc.constantFrom(...FIXED_SUFFIXES);

/** Model text with Latin, Urdu script and surrogate pairs; long cases force shortening. */
const modelTextArb: fc.Arbitrary<string> = fc.oneof(
  mixedScriptText({ maxLength: 200 }),
  mixedScriptText({ minLength: 300, maxLength: 1500 }),
);

/** Marker tokens that can stack at a line start, including full-width look-alikes. */
const MARKER_TOKENS: readonly string[] = [
  '-', '*', '•', '1.', '12.', '#', '_', '`', '**', '##', ' ', '\t', '\u00A0', '＊', '＃', '１.',
];
/** Lines that start with a random stack of markers and whitespace, then mixed text. */
const stackedMarkerTextArb: fc.Arbitrary<string> = fc
  .array(
    fc
      .tuple(
        fc.array(fc.constantFrom(...MARKER_TOKENS), { maxLength: 6 }),
        mixedScriptText({ maxLength: 40 }),
      )
      .map(([markers, rest]) => markers.join('') + rest),
    { maxLength: 6 },
  )
  .map((lines) => lines.join('\n'));
/** A list marker (`-`, `•` or digits plus `.`) followed by whitespace or the end. */
const LEADING_LIST_MARKER = /^(?:[-•]|\d+\.)(?:\s|$)/;

describe('answer.text properties', () => {
  // Feature: ai-answer-service, Property 3: Shortening keeps a clean prefix and an intact suffix
  // **Validates: Requirements 3.4, 3.5**
  it('Property 3: shortening keeps a clean prefix and an intact suffix', () => {
    fc.assert(
      fc.property(modelTextArb, suffixArb, (model, suffix) => {
        const cut = shortenToFit(model, suffix);
        const reply = joinReply(cut, suffix);

        expect(model.startsWith(cut)).toBe(true);
        if (cut !== model) {
          expect(cut).toBe(cut.trimEnd());
        }
        if (cut.length > 0) {
          expect(isHighSurrogate(cut.charCodeAt(cut.length - 1))).toBe(false);
        }
        expect(reply.endsWith(suffix)).toBe(true);
        expect(fitsSms(reply)).toBe(true);
      }),
      PBT_OPTIONS,
    );
  });

  // Feature: ai-answer-service, Property 4: Markdown markers are removed
  // **Validates: Requirements 3.8**
  it('Property 4: markdown markers are removed', () => {
    fc.assert(
      fc.property(fc.oneof(modelOutputArb, stackedMarkerTextArb), (text) => {
        const out = stripMarkdown(text);
        expect(out).not.toMatch(/[*_#`]/);
        for (const line of out.split(/\r\n|\r|\n/)) {
          expect(line).not.toMatch(LEADING_LIST_MARKER);
        }
        expect(normalizeMessage(out)).toBe(out);
      }),
      PBT_OPTIONS,
    );
  });
});
