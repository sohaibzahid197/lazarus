// Feature: necromancer-sms-gateway, Property 39: Pending_Stop_Record decoding is strict
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decodePendingStopRecord, type PendingStopRecord } from './gateway.pending.js';
import {
  GATEWAY_PBT_OPTIONS,
  canonicalNumber,
  countryCode,
  pendingStopRecord,
  timeArb,
} from './gateway.arbitraries.js';
import { STOP_MARKER } from './stopAliases.js';

type Raw = Record<string, unknown>;

const RECORD_KEYS = ['id', 'sender', 'marker', 'receivedAt'] as const;

/** Realistic records from the shared arbitrary, plus records with any sender string. */
const validRecord: fc.Arbitrary<PendingStopRecord> = fc.oneof(
  fc
    .tuple(fc.option(canonicalNumber, { nil: null }), countryCode)
    .chain(([own, cc]) => pendingStopRecord(own, cc)),
  fc.record({
    id: fc.maxSafeNat(),
    sender: fc.string(),
    marker: fc.constant(STOP_MARKER),
    receivedAt: timeArb,
  }),
);

const extraKeyName: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom('body', 'text', 'message', 'keyword', 'language'),
  fc
    .string({ minLength: 1, maxLength: 12 })
    .filter((k) => !(RECORD_KEYS as readonly string[]).includes(k) && k !== '__proto__'),
);

const withExtraKey: fc.Arbitrary<Raw> = fc
  .tuple(validRecord, extraKeyName, fc.jsonValue())
  .map(([rec, key, value]) => ({ ...rec, [key]: value }));

const withMissingKeys: fc.Arbitrary<Raw> = fc
  .tuple(validRecord, fc.subarray([...RECORD_KEYS], { minLength: 1 }))
  .map(([rec, drop]) => {
    const copy: Raw = { ...rec };
    for (const key of drop) delete copy[key];
    return copy;
  });

const notSafeInteger: fc.Arbitrary<unknown> = fc.oneof(
  fc.double().filter((d) => !Number.isSafeInteger(d)),
  fc.constantFrom(Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, 1.5),
  fc.constantFrom('1', null, true, undefined, [], {}),
  fc.bigInt(),
);

const BAD_VALUES: Readonly<Record<(typeof RECORD_KEYS)[number], fc.Arbitrary<unknown>>> = {
  id: notSafeInteger,
  receivedAt: notSafeInteger,
  sender: fc.oneof(fc.integer(), fc.constantFrom(null, true, undefined, [], {}), fc.bigInt()),
  marker: fc.oneof(
    fc.string().filter((s) => s !== STOP_MARKER),
    fc.constantFrom('stop', 'Stop', ' STOP', 'STOP ', 'START', '', 1, null, true, undefined, ['STOP']),
  ),
};

const withBadField: fc.Arbitrary<Raw> = fc
  .tuple(validRecord, fc.constantFrom(...RECORD_KEYS))
  .chain(([rec, key]) => BAD_VALUES[key].map((bad): Raw => ({ ...rec, [key]: bad })));

const nonObject: fc.Arbitrary<unknown> = fc.oneof(
  fc.anything().filter((v) => v === null || typeof v !== 'object' || Array.isArray(v)),
  validRecord.map((rec) => [rec.id, rec.sender, rec.marker, rec.receivedAt]),
  validRecord.map((rec) => [rec]),
  fc.constantFrom(null, undefined, 'STOP', 0, true),
);

function decodesToNull(raw: unknown): void {
  let result: PendingStopRecord | null | undefined;
  expect(() => {
    result = decodePendingStopRecord(raw);
  }).not.toThrow();
  expect(result).toBeNull();
}

describe('decodePendingStopRecord strictness', () => {
  /** **Validates: Requirements 14.13, 9.13** */
  it('Req 14.13, 9.13: a valid record decodes to an equal value, also after a JSON round trip', () => {
    fc.assert(
      fc.property(validRecord, (rec) => {
        expect(decodePendingStopRecord({ ...rec })).toEqual(rec);
        expect(decodePendingStopRecord(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });

  /** **Validates: Requirements 14.13, 9.13** */
  it('Req 14.13, 9.13: any extra key (such as body) decodes to null', () => {
    fc.assert(fc.property(withExtraKey, decodesToNull), GATEWAY_PBT_OPTIONS);
  });

  /** **Validates: Requirements 14.13, 9.13** */
  it('Req 14.13, 9.13: removing any key decodes to null', () => {
    fc.assert(fc.property(withMissingKeys, decodesToNull), GATEWAY_PBT_OPTIONS);
  });

  /** **Validates: Requirements 14.13, 9.13** */
  it('Req 14.13, 9.13: a wrong marker or a field of the wrong type decodes to null', () => {
    fc.assert(fc.property(withBadField, decodesToNull), GATEWAY_PBT_OPTIONS);
  });

  /** **Validates: Requirements 14.13, 9.13** */
  it('Req 14.13, 9.13: non-objects, arrays and null decode to null without throwing', () => {
    fc.assert(fc.property(nonObject, decodesToNull), GATEWAY_PBT_OPTIONS);
  });
});
