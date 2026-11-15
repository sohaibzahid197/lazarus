// Feature: necromancer-sms-gateway, Property 31: Invalid settings fall back to defaults
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_SETTINGS, parseSettings, serializeSettings } from './gateway.settings.js';
import { GATEWAY_PBT_OPTIONS, settings } from './gateway.arbitraries.js';

type Wire = Record<string, unknown>;

const WIRE_KEYS = [
  'v',
  'allowlistMode',
  'perNumberLimit',
  'rateWindowMinutes',
  'dailySendCap',
  'defaultCountryCode',
  'ownNumber',
] as const;

/** A valid wire object, as written by serializeSettings. */
const validWire: fc.Arbitrary<Wire> = settings.map((s) => JSON.parse(serializeSettings(s)) as Wire);

const notInteger = fc.oneof(
  fc.constant(1.5),
  fc.constant(null),
  fc.constant('5'),
  fc.constant(true),
  fc.constant([]),
  fc.constant({}),
);

const outOfRange = (min: number, max: number): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.integer({ min: -100_000, max: min - 1 }),
    fc.integer({ min: max + 1, max: 100_000 }),
    notInteger,
  );

/** For each wire field, values that break its rule (wrong type or out of range). */
const BAD_VALUES: Readonly<Record<(typeof WIRE_KEYS)[number], fc.Arbitrary<unknown>>> = {
  v: fc.oneof(fc.integer().filter((n) => n !== 1), fc.constantFrom('1', null, true, 1.5)),
  allowlistMode: fc.constantFrom(0, 1, 'true', 'false', null, [], {}),
  perNumberLimit: outOfRange(1, 60),
  rateWindowMinutes: outOfRange(1, 1440),
  dailySendCap: outOfRange(1, 2000),
  defaultCountryCode: fc.oneof(
    fc.constantFrom('', '0', '01', '1234', '9a', ' 92', '+92', 92, null, true),
    fc.stringMatching(/^0\d{0,2}$/),
    fc.stringMatching(/^[1-9]\d{3,6}$/),
  ),
  ownNumber: fc.oneof(
    fc.constantFrom('', '+', '+0123456789', '923001234567', '+92 300 1234567', 923001234567, true, {}),
    fc.stringMatching(/^\+[1-9]\d{0,5}$/),
    fc.stringMatching(/^\+[1-9]\d{15,20}$/),
  ),
};

const fieldMutated: fc.Arbitrary<string> = fc
  .tuple(validWire, fc.constantFrom(...WIRE_KEYS))
  .chain(([wire, key]) => BAD_VALUES[key].map((bad) => JSON.stringify({ ...wire, [key]: bad })));

const extraKey: fc.Arbitrary<string> = fc
  .tuple(
    validWire,
    fc.string({ minLength: 1, maxLength: 12 }).filter(
      (k) => !(WIRE_KEYS as readonly string[]).includes(k) && k !== '__proto__',
    ),
    fc.jsonValue(),
  )
  .map(([wire, key, value]) => JSON.stringify({ ...wire, [key]: value }));

const missingKeys: fc.Arbitrary<string> = fc
  .tuple(validWire, fc.subarray([...WIRE_KEYS], { minLength: 1 }))
  .map(([wire, drop]) => {
    const copy: Wire = { ...wire };
    for (const key of drop) delete copy[key];
    return JSON.stringify(copy);
  });

const truncated: fc.Arbitrary<string> = settings
  .map(serializeSettings)
  .chain((text) => fc.integer({ min: 0, max: text.length - 1 }).map((n) => text.slice(0, n)));

const notJson: fc.Arbitrary<string> = fc.string().filter((s) => {
  try {
    JSON.parse(s);
    return false;
  } catch {
    return true;
  }
});

/** Valid JSON that is not an object: arrays, numbers, strings, booleans, null. */
const nonObjectJson: fc.Arbitrary<string> = fc
  .jsonValue()
  .filter((v) => v === null || typeof v !== 'object' || Array.isArray(v))
  .map((v) => JSON.stringify(v));

const invalidStored: fc.Arbitrary<string> = fc.oneof(
  fieldMutated,
  extraKey,
  missingKeys,
  truncated,
  notJson,
  nonObjectJson,
);

describe('parseSettings invalid and missing input', () => {
  /** **Validates: Requirements 15.3, 15.5** */
  it('Req 15.3, 15.5: any invalid stored string parses as invalid with DEFAULT_SETTINGS', () => {
    fc.assert(
      fc.property(invalidStored, (raw) => {
        const parsed = parseSettings(raw);
        expect(parsed.status).toBe('invalid');
        expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });

  /** **Validates: Requirements 15.3** */
  it('Req 15.3: null (nothing stored) parses as missing with the Req 15.3 defaults', () => {
    const parsed = parseSettings(null);
    expect(parsed.status).toBe('missing');
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({
      allowlistMode: false,
      perNumberLimit: 5,
      rateWindowMinutes: 60,
      dailySendCap: 200,
      defaultCountryCode: '92',
      ownNumber: null,
    });
  });
});
