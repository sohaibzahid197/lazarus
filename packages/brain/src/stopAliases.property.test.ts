// Feature: necromancer-sms-gateway, Property 36: Stop_Keyword_Check is sound and covers plain STOP forms
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GATEWAY_PBT_OPTIONS, anyBody, stopAliasBody } from './gateway.arbitraries.js';
import { routeCommand } from './router.js';
import { STOP_ALIAS_LIST, stopKeywordCheck } from './stopAliases.js';

/** Bodies close to a STOP form: an alias with random unicode around and inside it. */
const nearStopBody: fc.Arbitrary<string> = fc
  .tuple(
    fc.string({ unit: 'binary', maxLength: 3 }),
    fc.constantFrom(...STOP_ALIAS_LIST),
    fc.string({ unit: 'binary', maxLength: 3 }),
    fc.string({ maxLength: 20 }),
  )
  .map(([lead, alias, inner, tail]) => lead + alias + inner + tail);

const soundnessBody: fc.Arbitrary<string> = fc.oneof(
  anyBody,
  stopAliasBody,
  nearStopBody,
  fc.string({ unit: 'binary', maxLength: 50 }),
);

describe('Property 36: Stop_Keyword_Check is sound and covers plain STOP forms', () => {
  /** **Validates: Requirements 9.13, 17.7** */
  it('Requirements 9.13, 17.7: stopKeywordCheck true implies routeCommand gives STOP', () => {
    fc.assert(
      fc.property(soundnessBody, (b) => {
        if (stopKeywordCheck(b)) {
          expect(routeCommand(b).command).toBe('STOP');
        }
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });

  /** **Validates: Requirements 9.13, 17.7** */
  it('Requirements 9.13, 17.7: every plain STOP form passes stopKeywordCheck', () => {
    fc.assert(
      fc.property(stopAliasBody, (b) => {
        expect(stopKeywordCheck(b)).toBe(true);
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
