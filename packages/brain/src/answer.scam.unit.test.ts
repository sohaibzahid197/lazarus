// Example tests for the Scam_Parser and Scam_Printer.
// _Requirements: 9.2, 9.5, 9.6, 9.7, 13.7_
import { describe, expect, it } from 'vitest';
import { parseScam, printScam } from './answer.scam.js';
import { FIXED_TEXTS } from './answer.texts.js';
import type { ScamResult, ScamVerdict } from './answer.types.js';
import { LANGUAGES } from './router.types.js';

const VERDICTS: readonly ScamVerdict[] = ['SCAM', 'SAFE', 'UNSURE'];

/** A localized Reason per Language, distinct from the fixed Reasons. */
const REASON = {
  en: 'It asks for your OTP.',
  'roman-ur': 'Yeh aap ka OTP maang raha hai.',
  ur: 'یہ آپ کا کوڈ مانگ رہا ہے۔',
} as const;

describe('printScam', () => {
  for (const language of LANGUAGES) {
    for (const verdict of VERDICTS) {
      it(`prints ${verdict} in ${language} as "<word>: <reason>"`, () => {
        const word = FIXED_TEXTS[language].scamWord[verdict];
        const result: ScamResult = { verdict, reason: REASON[language] };
        expect(printScam(result, language)).toBe(`${word}: ${REASON[language]}`);
      });
    }
  }

  it('prints the localized word, not the canonical token, in Roman Urdu', () => {
    expect(printScam({ verdict: 'SCAM', reason: 'x' }, 'roman-ur')).toBe('DHOKA: x');
  });
});

describe('parseScam', () => {
  for (const language of LANGUAGES) {
    for (const verdict of VERDICTS) {
      it(`parses the printed ${verdict} line in ${language} back to the same result`, () => {
        const result: ScamResult = { verdict, reason: REASON[language] };
        expect(parseScam(printScam(result, language), language)).toEqual(result);
      });

      it(`accepts the canonical English token ${verdict} with a ${language} Reason`, () => {
        expect(parseScam(`${verdict}: ${REASON[language]}`, language)).toEqual({
          verdict,
          reason: REASON[language],
        });
      });

      it(`uses the fixed ${language} Reason for ${verdict} when the Reason is blank`, () => {
        const word = FIXED_TEXTS[language].scamWord[verdict];
        const expected: ScamResult = { verdict, reason: FIXED_TEXTS[language].scamReason[verdict] };
        expect(parseScam(`${word}:`, language)).toEqual(expected);
        expect(parseScam(`${word}: \t  `, language)).toEqual(expected);
      });
    }

    it(`returns UNSURE for an unknown verdict word in ${language}`, () => {
      expect(parseScam(`MAYBE: ${REASON[language]}`, language)).toEqual({
        verdict: 'UNSURE',
        reason: REASON[language],
      });
    });

    it(`returns UNSURE with the fixed UNSURE Reason for an unknown word and blank Reason in ${language}`, () => {
      expect(parseScam('MAYBE:   ', language)).toEqual({
        verdict: 'UNSURE',
        reason: FIXED_TEXTS[language].scamReason.UNSURE,
      });
    });

    it(`returns UNSURE with the unparseable Reason when there is no colon in ${language}`, () => {
      expect(parseScam('SCAM this asks for your PIN', language)).toEqual({
        verdict: 'UNSURE',
        reason: FIXED_TEXTS[language].scamReason.unparseable,
      });
    });

    it(`returns UNSURE with the unparseable Reason for empty or blank output in ${language}`, () => {
      const expected: ScamResult = {
        verdict: 'UNSURE',
        reason: FIXED_TEXTS[language].scamReason.unparseable,
      };
      expect(parseScam('', language)).toEqual(expected);
      expect(parseScam(' \n\t\n', language)).toEqual(expected);
      expect(parseScam(': only a reason', language)).toEqual(expected);
    });
  }

  it('does not accept a localized word from another Language', () => {
    expect(parseScam('DHOKA: asks for money', 'en').verdict).toBe('UNSURE');
    expect(parseScam('دھوکہ: asks for money', 'roman-ur').verdict).toBe('UNSURE');
  });

  it('matches verdict words case-insensitively and ignores surrounding spaces', () => {
    expect(parseScam('  scam : asks for money', 'en')).toEqual({ verdict: 'SCAM', reason: 'asks for money' });
    expect(parseScam('yaqeen nahi: pata nahi', 'roman-ur')).toEqual({ verdict: 'UNSURE', reason: 'pata nahi' });
  });

  it('splits at the first colon only', () => {
    expect(parseScam('SAFE: meeting at 10:30', 'en')).toEqual({ verdict: 'SAFE', reason: 'meeting at 10:30' });
  });

  it('uses only the first non-blank line of multi-line output', () => {
    const output = '\n  \r\nSCAM: Asks for your PIN.\nSAFE: ignore this\r\nmore text';
    expect(parseScam(output, 'en')).toEqual({ verdict: 'SCAM', reason: 'Asks for your PIN.' });
  });

  it('returns the unparseable Reason when the first non-blank line has no colon', () => {
    expect(parseScam('Here is my answer\nSCAM: asks for PIN', 'en')).toEqual({
      verdict: 'UNSURE',
      reason: FIXED_TEXTS.en.scamReason.unparseable,
    });
  });

  it('caps the Reason to 120 code points', () => {
    const { reason } = parseScam(`SCAM: ${'ب'.repeat(200)}`, 'ur');
    expect(Array.from(reason)).toHaveLength(120);
  });
});
