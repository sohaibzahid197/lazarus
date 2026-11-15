import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REMINDER_PBT_OPTIONS } from './reminder.arbitraries.js';
import { routeCommand } from './router.js';
import {
  anyText,
  cancelAliasArb,
  caseMutate,
  freeAliasArb,
  listAliasArb,
  plainLatinWordArb,
  punctArb,
  wsArb,
} from './router.arbitraries.js';
import { COMMANDS } from './router.types.js';
import { STOP_ALIAS_LIST } from './stopAliases.js';

const COMMAND_SET: ReadonlySet<string> = new Set(COMMANDS);

/** A STOP alias in any letter case with 0 to 3 trailing punctuation characters. */
const stopKeywordArb: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(...STOP_ALIAS_LIST).chain(caseMutate), punctArb)
  .map(([alias, punct]) => alias + punct);

/** A LIST or CANCEL Keyword in any letter case with optional trailing punctuation. */
const listCancelKeywordArb: fc.Arbitrary<string> = fc
  .tuple(fc.oneof(listAliasArb, cancelAliasArb).chain(caseMutate), punctArb)
  .map(([kw, punct]) => kw + punct);

const slotArb: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(...'0123456789۰۱۲۳۴۵۶۷۸۹'.split('')),
  minLength: 1,
  maxLength: 3,
});

/** Text after a first token: random text, or LIST/CANCEL forms such as `list` and `cancel 2`. */
const tailArb: fc.Arbitrary<string> = fc.oneof(
  anyText,
  listCancelKeywordArb,
  fc.tuple(listCancelKeywordArb, wsArb, slotArb).map(([kw, ws, slot]) => kw + ws + slot),
  fc.tuple(listCancelKeywordArb, wsArb, anyText).map(([kw, ws, t]) => kw + ws + t),
);

/** First token that is not a LIST or CANCEL Keyword: a free alias or a plain word. */
const nonListCancelHeadArb: fc.Arbitrary<string> = fc
  .tuple(fc.oneof(freeAliasArb.chain(caseMutate), plainLatinWordArb), punctArb)
  .map(([word, punct]) => word + punct);

// Feature: sms-reminders, Property 3: Router stays total and STOP keeps precedence
describe('Property 3: Router stays total and STOP keeps precedence', () => {
  /**
   * **Validates: Requirements 1.11**
   */
  it('1.11 any input of 0 to 1,000 characters routes to one of the 9 Commands without throwing', () => {
    fc.assert(
      fc.property(anyText, (input) => {
        const r = routeCommand(input);
        expect(COMMAND_SET.has(r.command)).toBe(true);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });

  /**
   * **Validates: Requirements 1.7**
   */
  it('1.7 a STOP Keyword followed by any text, LIST and CANCEL forms included, routes to STOP', () => {
    fc.assert(
      fc.property(
        stopKeywordArb,
        fc.oneof(fc.constant(''), fc.tuple(wsArb, tailArb).map(([ws, t]) => ws + t)),
        (keyword, after) => {
          expect(routeCommand(keyword + after).command).toBe('STOP');
        },
      ),
      REMINDER_PBT_OPTIONS,
    );
    expect(routeCommand('stop list').command).toBe('STOP');
    expect(routeCommand('stop cancel 2').command).toBe('STOP');
  });

  /**
   * **Validates: Requirements 1.7**
   */
  it('1.7 LIST or CANCEL Keywords after the first token do not change the routed Command', () => {
    fc.assert(
      fc.property(
        nonListCancelHeadArb,
        wsArb,
        listCancelKeywordArb,
        fc.oneof(fc.constant(''), fc.tuple(wsArb, tailArb).map(([ws, t]) => ws + t)),
        (head, ws, keyword, after) => {
          const without = routeCommand(head).command;
          const withKeyword = routeCommand(head + ws + keyword + after).command;
          expect(withKeyword).toBe(without);
        },
      ),
      REMINDER_PBT_OPTIONS,
    );
  });
});
