// Feature: crypt-ouija-simulator, Property 3: Committed text only grows
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { keyEventsArb, t9ModeArb } from '../test/arbitraries/t9';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { T9_KEYS } from './keymap';
import { decodeT9 } from './t9.decode';
import { MULTI_TAP_TIMEOUT_MS, type KeyEvent } from './t9.step';

/** Gap before the extra press: equal time, the timeout edges, or any later time. */
const extraGapArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.constantFrom(MULTI_TAP_TIMEOUT_MS - 1, MULTI_TAP_TIMEOUT_MS),
  fc.integer({ min: 1, max: 86_400_000 }),
);

describe('T9_Decoder prefix rule', () => {
  /**
   * **Validates: Requirements 4.11**
   */
  it('Feature: crypt-ouija-simulator, Property 3: Committed text only grows', () => {
    fc.assert(
      fc.property(
        keyEventsArb.map((events) => events.slice(0, 299)),
        fc.constantFrom(...T9_KEYS),
        extraGapArb,
        t9ModeArb,
        (events, key, gap, start) => {
          const lastAt = events[events.length - 1]?.at ?? 0;
          const longer: readonly KeyEvent[] = [...events, { key, at: lastAt + gap }];
          const short = decodeT9(events, start);
          const long = decodeT9(longer, start);
          expect(short.ok).toBe(true);
          expect(long.ok).toBe(true);
          if (!short.ok || !long.ok) return;
          expect(long.text.startsWith(short.text)).toBe(true);
        },
      ),
      CRYPT_PBT_OPTIONS,
    );
  });
});
