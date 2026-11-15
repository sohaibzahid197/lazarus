// Feature: necromancer-sms-gateway, Property 1: Normalizer matches the reference rules
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { countryCode, formattedNumber, GATEWAY_PBT_OPTIONS } from './gateway.arbitraries.js';
import { FALLBACK_COUNTRY_CODE, maskSender, normalizeSender } from './gateway.number.js';
import type { CanonicalNumber, SenderIdentity } from './gateway.types.js';

// ---------------------------------------------------------------------------
// Reference model, written from Requirement 2 character by character
// (no regular expressions shared with the implementation).
// ---------------------------------------------------------------------------

const SEPARATOR_SET = new Set([' ', '-', '.', '(', ')']);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';

function automatedRef(address: string): SenderIdentity {
  return { kind: 'automated', masked: maskSender(address) };
}

function effectiveCountryCode(cc: string | undefined): string {
  if (cc === undefined || cc.length < 1 || cc.length > 3) return FALLBACK_COUNTRY_CODE;
  if (![...cc].every(isDigit) || cc[0] === '0') return FALLBACK_COUNTRY_CODE;
  return cc;
}

function referenceNormalize(address: string, cc?: string): SenderIdentity {
  const chars = [...address];
  let hasPlus = false;
  let digits = '';
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i] ?? '';
    if (c === '+') {
      // 2.5: a `+` is allowed only as the very first character.
      if (i !== 0) return automatedRef(address);
      hasPlus = true;
    } else if (isDigit(c)) {
      digits += c;
    } else if (!SEPARATOR_SET.has(c)) {
      // 2.5: letters and any other character mark an Automated_Sender.
      return automatedRef(address);
    }
  }
  // 2.5: the Sender_Address itself must carry 7 to 15 digits.
  if (digits.length < 7 || digits.length > 15) return automatedRef(address);

  let result: string;
  if (hasPlus) result = digits; // 2.1
  else if (digits.startsWith('00')) result = digits.slice(2); // 2.2
  else if (digits[0] === '0') result = effectiveCountryCode(cc) + digits.slice(1); // 2.3 (2.12)
  else result = digits; // 2.4

  // 2.11: 7 to 15 digits, first digit not 0.
  if (result.length < 7 || result.length > 15 || result[0] === '0') return automatedRef(address);
  return { kind: 'phone', number: `+${result}` as CanonicalNumber };
}

// ---------------------------------------------------------------------------
// Generators: strings built from digits, separators, `+`, letters and others.
// ---------------------------------------------------------------------------

const digitChar = fc.constantFrom(...'0123456789'.split(''));
const separatorChar = fc.constantFrom(' ', '-', '.', '(', ')');
const otherChar = fc.constantFrom('a', 'Z', '#', '*', '/', '_', '٣', 'ب', '\t', '١', '０');

/** Mostly digits so lengths around 7–15 are common; rare `+` and others. */
const mixedChar = fc.oneof(
  { arbitrary: digitChar, weight: 12 },
  { arbitrary: separatorChar, weight: 3 },
  { arbitrary: fc.constant('+'), weight: 1 },
  { arbitrary: otherChar, weight: 1 },
);

const mixedAddress: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: mixedChar, maxLength: 22 }),
  // A leading prefix that hits each rule.
  fc
    .tuple(fc.constantFrom('+', '00', '0', '000', '+0', ''), fc.string({ unit: mixedChar, maxLength: 18 }))
    .map(([prefix, rest]) => prefix + rest),
);

/** Any Default_Country_Code input: valid, invalid or absent. */
const anyCountryCode: fc.Arbitrary<string | undefined> = fc.oneof(
  countryCode,
  fc.constantFrom(undefined, '', '0', '01', '1234', 'ab', '+92', ' 92'),
);

describe('normalizeSender reference rules (Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.11, 2.12)', () => {
  it('Property 1: matches the reference model for mixed strings (Req 2.1, 2.2, 2.3, 2.4, 2.5, 2.11, 2.12)', () => {
    fc.assert(
      fc.property(mixedAddress, anyCountryCode, (address, cc) => {
        expect(normalizeSender(address, cc)).toEqual(referenceNormalize(address, cc));
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });

  it('Property 1: matches the reference model for formatted phone numbers (Req 2.1, 2.2, 2.3, 2.4, 2.12)', () => {
    fc.assert(
      fc.property(
        countryCode.chain((cc) => formattedNumber(cc).map((f) => ({ cc, f }))),
        ({ cc, f }) => {
          const expected = referenceNormalize(f.address, cc);
          expect(normalizeSender(f.address, cc)).toEqual(expected);
          expect(expected).toEqual({ kind: 'phone', number: f.number });
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
