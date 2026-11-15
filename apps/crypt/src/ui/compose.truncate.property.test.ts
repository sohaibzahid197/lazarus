// Feature: crypt-ouija-simulator, Property 8: Compose truncation keeps the text or a safe prefix
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_BODY_UNITS } from '../protocol/limits';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { truncateCompose } from './compose';

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const anyText = fc.string({ unit: 'binary', maxLength: 40 });

// Strings of any Unicode, biased so their length lands near the 480-unit limit
// and so a surrogate pair (or lone surrogate) often straddles code unit 480.
const composeTextArb = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 600 }),
  fc
    .tuple(fc.integer({ min: 0, max: MAX_BODY_UNITS + 20 }), anyText)
    .map(([pad, tail]) => 'a'.repeat(pad) + tail),
  fc
    .tuple(fc.integer({ min: MAX_BODY_UNITS - 3, max: MAX_BODY_UNITS + 1 }), fc.constantFrom('😀', '\ud83d', 'آ'), anyText)
    .map(([pad, mid, tail]) => 'x'.repeat(pad) + mid + tail),
);

describe('truncateCompose', () => {
  /**
   * **Validates: Requirements 5.1, 5.4**
   */
  it('Feature: crypt-ouija-simulator, Property 8: Compose truncation keeps the text or a safe prefix', () => {
    fc.assert(
      fc.property(composeTextArb, (text) => {
        const out = truncateCompose(text);
        if (text.length <= MAX_BODY_UNITS) {
          expect(out).toBe(text);
          return;
        }
        const cut = isHighSurrogate(text.charCodeAt(MAX_BODY_UNITS - 1)) ? MAX_BODY_UNITS - 1 : MAX_BODY_UNITS;
        expect(out).toBe(text.slice(0, cut));
        // For well-formed input the cut never splits a pair. (Input that already
        // holds lone surrogates may keep one; the rule only forbids making one.)
        if (!LONE_SURROGATE.test(text)) {
          expect(isHighSurrogate(out.charCodeAt(out.length - 1))).toBe(false);
        }
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
