// Unit tests for the number functions (necromancer-sms-gateway task 2.7).
// Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.11, 2.12, 2.13
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_COUNTRY_CODE,
  isCanonicalNumber,
  isValidCountryCode,
  maskNumber,
  maskSender,
  normalizeSender,
  printNumber,
} from './gateway.number.js';
import type { CanonicalNumber } from './gateway.types.js';

const PK = { kind: 'phone', number: '+923001234567' } as const;

const num = (s: string): CanonicalNumber => {
  if (!isCanonicalNumber(s)) throw new Error(`not canonical: ${s}`);
  return s;
};

describe('normalizeSender: phone forms', () => {
  it('keeps a leading + and strips separators (2.1)', () => {
    expect(normalizeSender('+92 300 1234567')).toEqual(PK);
    expect(normalizeSender('+92 (300) 123-45.67')).toEqual(PK);
  });

  it('replaces a leading 00 with + (2.2)', () => {
    expect(normalizeSender('0092 300 1234567')).toEqual(PK);
    expect(normalizeSender('00923001234567')).toEqual(PK);
  });

  it('replaces a single leading 0 with the country code (2.3)', () => {
    expect(normalizeSender('03001234567', '92')).toEqual(PK);
    expect(normalizeSender('0300-1234567', '44')).toEqual({
      kind: 'phone',
      number: '+443001234567',
    });
  });

  it('adds only + to a number starting with 1 to 9 (2.4)', () => {
    expect(normalizeSender('923001234567')).toEqual(PK);
    expect(normalizeSender('923001234567', '44')).toEqual(PK);
  });
});

describe('normalizeSender: automated senders', () => {
  it('marks a letter sender ID as automated (2.5)', () => {
    expect(normalizeSender('JAZZ')).toEqual({ kind: 'automated', masked: '•AZZ' });
  });

  it('marks a 4-digit short code as automated (2.5)', () => {
    expect(normalizeSender('8888')).toEqual({ kind: 'automated', masked: '•888' });
  });

  it('marks an empty address as automated (2.5)', () => {
    expect(normalizeSender('')).toEqual({ kind: 'automated', masked: '•' });
  });

  it('marks a 16-digit number as automated (2.5, 2.11)', () => {
    const result = normalizeSender('+9230012345678901');
    expect(result.kind).toBe('automated');
    expect(result).not.toHaveProperty('number');
  });

  it('accepts 7 and 15 digits at the bounds (2.5)', () => {
    expect(normalizeSender('+1234567')).toEqual({ kind: 'phone', number: '+1234567' });
    expect(normalizeSender('+123456789012345').kind).toBe('phone');
    expect(normalizeSender('+123456').kind).toBe('automated');
  });

  it('marks a misplaced + as automated (2.5)', () => {
    expect(normalizeSender('92+3001234567').kind).toBe('automated');
    expect(normalizeSender('92300123456+').kind).toBe('automated');
  });

  it('marks a result starting with 0 after + as automated (2.11)', () => {
    expect(normalizeSender('+0923001234567').kind).toBe('automated');
    expect(normalizeSender('000923001234567').kind).toBe('automated');
  });
});

describe('normalizeSender: default country code (2.12)', () => {
  it('uses 92 when no code is set', () => {
    expect(FALLBACK_COUNTRY_CODE).toBe('92');
    expect(normalizeSender('03001234567')).toEqual(PK);
  });

  it.each(['0', '', '1234', '9a', '+92', '09'])('falls back to 92 for invalid code %j', (code) => {
    expect(normalizeSender('03001234567', code)).toEqual(PK);
  });

  it('accepts codes of 1 to 3 digits starting 1 to 9', () => {
    expect(isValidCountryCode('1')).toBe(true);
    expect(isValidCountryCode('92')).toBe(true);
    expect(isValidCountryCode('880')).toBe(true);
    expect(normalizeSender('01712345678', '880')).toEqual({
      kind: 'phone',
      number: '+8801712345678',
    });
  });
});

describe('printNumber and maskNumber', () => {
  it('prints the canonical form unchanged', () => {
    expect(printNumber(num('+923001234567'))).toBe('+923001234567');
  });

  it('masks all digits but the last 3', () => {
    expect(maskNumber(num('+923001234567'))).toBe('+•••••••••567');
  });
});

describe('maskSender (2.13)', () => {
  it('returns • for an empty address', () => {
    expect(maskSender('')).toBe('•');
  });

  it.each(['A', 'AB', 'ABC', '123'])('returns %j of 1 to 3 characters unchanged', (s) => {
    expect(maskSender(s)).toBe(s);
  });

  it('keeps the last 3 characters of a long ID', () => {
    expect(maskSender('TELENOR-INFO')).toBe('•••••••••NFO');
    expect(maskSender('ABCD')).toBe('•BCD');
  });
});
