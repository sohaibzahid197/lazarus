// Feature: necromancer-sms-gateway, Property 10: Allowlist add keeps one canonical entry
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ALLOWLIST_MAX, addToAllowlist } from './gateway.settings.js';
import {
  GATEWAY_PBT_OPTIONS,
  automatedAddress,
  canonicalNumber,
  countryCode,
  formattedNumber,
  formattingOf,
} from './gateway.arbitraries.js';
import type { CanonicalNumber } from './gateway.types.js';

/** An Allowlist of 0 to 20 entries. */
const smallList: fc.Arbitrary<Set<CanonicalNumber>> = fc
  .array(canonicalNumber, { maxLength: 20 })
  .map((numbers) => new Set(numbers));

/** An Allowlist of exactly ALLOWLIST_MAX distinct entries. */
const fullList: fc.Arbitrary<Set<CanonicalNumber>> = fc
  .uniqueArray(canonicalNumber, { minLength: ALLOWLIST_MAX, maxLength: ALLOWLIST_MAX })
  .map((numbers) => new Set(numbers));

/** A country code, a number formatted for it, and a second formatting of the same number. */
const twoFormattings = countryCode.chain((cc) =>
  formattedNumber(cc).chain((first) =>
    formattingOf(first.number, cc).map((second) => ({ cc, first, second })),
  ),
);

describe('addToAllowlist', () => {
  /** **Validates: Requirements 4.4** */
  it('Req 4.4: adding any formatting stores one canonical entry; re-adding is duplicate', () => {
    fc.assert(
      fc.property(twoFormattings, smallList, ({ cc, first, second }, base) => {
        const list = new Set(base);
        list.delete(first.number);
        const added = addToAllowlist(list, first.address, cc);
        expect(added).toEqual({ status: 'added', number: first.number });

        const after = new Set(list).add(first.number);
        expect(after.size).toBe(list.size + 1);
        const again = addToAllowlist(after, second.address, cc);
        expect(again).toEqual({ status: 'duplicate', number: first.number });
        expect([...after].filter((n) => n === first.number)).toHaveLength(1);
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });

  /** **Validates: Requirements 4.5** */
  it('Req 4.5: an Automated_Sender value is invalid for any list', () => {
    fc.assert(
      fc.property(
        countryCode,
        automatedAddress,
        fc.oneof(smallList, fullList),
        (cc, address, list) => {
          expect(addToAllowlist(list, address, cc)).toEqual({ status: 'invalid' });
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
  });

  /** **Validates: Requirements 4.10, 4.4** */
  it('Req 4.10: a full list of 500 rejects a new number and still reports duplicates', () => {
    fc.assert(
      fc.property(
        countryCode.chain((cc) => fc.tuple(fc.constant(cc), formattedNumber(cc))),
        fullList,
        ([cc, formatted], list) => {
          expect(list.size).toBe(ALLOWLIST_MAX);
          const expected = list.has(formatted.number)
            ? { status: 'duplicate', number: formatted.number }
            : { status: 'full' };
          expect(addToAllowlist(list, formatted.address, cc)).toEqual(expected);

          const withMember = [...list][0];
          if (withMember === undefined) throw new Error('full list is empty');
          expect(addToAllowlist(list, withMember, cc)).toEqual({
            status: 'duplicate',
            number: withMember,
          });
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
