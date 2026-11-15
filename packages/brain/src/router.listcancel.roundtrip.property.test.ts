import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { printCommand } from './printer.js';
import { routeCommand } from './router.js';
import type { RoutedCommand } from './router.types.js';
import { REMINDER_PBT_OPTIONS } from './reminder.arbitraries.js';
import { cancelAliasArb, caseMutate, listAliasArb, punctArb, wsArb } from './router.arbitraries.js';

const digitArb = fc.constantFrom(...'0123456789۰۱۲۳۴۵۶۷۸۹'.split(''));
/** Slot token: 1 to 3 ASCII or Extended Arabic-Indic digits, mixed freely. */
const slotTokenArb: fc.Arbitrary<string> = fc.string({ unit: digitArb, minLength: 1, maxLength: 3 });
/** Optional surrounding whitespace. */
const padArb: fc.Arbitrary<string> = fc.oneof(fc.constant(''), wsArb);

/** LIST or CANCEL keyword in random case, with trailing punctuation, optionally followed by a slot token. */
const messageArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.oneof(listAliasArb, cancelAliasArb),
    punctArb,
    fc.option(fc.tuple(wsArb, slotTokenArb), { nil: undefined }),
    padArb,
    padArb,
  )
  .chain(([alias, punct, slot, lead, trail]) =>
    caseMutate(alias).map((kw) => {
      const tail = slot === undefined ? '' : slot[0] + slot[1];
      return `${lead}${kw}${punct}${tail}${trail}`;
    }),
  );

/** Routed_Commands with the Command LIST or CANCEL, produced by routeCommand. */
const listCancelRoutedArb: fc.Arbitrary<RoutedCommand> = messageArb
  .map((message) => routeCommand(message))
  .filter((routed) => routed.command === 'LIST' || routed.command === 'CANCEL');

const withoutLanguage = (r: RoutedCommand): Omit<RoutedCommand, 'language'> => ({
  command: r.command,
  argument: r.argument,
  argumentMissing: r.argumentMissing,
});

describe('sms-reminders Command_Printer round trip for LIST and CANCEL', () => {
  // Feature: sms-reminders, Property 2: LIST and CANCEL print and route round trip
  // **Validates: Requirements 1.8, 1.9**
  it('1.9 routing printCommand of a LIST/CANCEL Routed_Command keeps command, argument and argumentMissing', () => {
    fc.assert(
      fc.property(listCancelRoutedArb, (routed) => {
        const printed = printCommand(routed);
        expect(withoutLanguage(routeCommand(printed))).toEqual(withoutLanguage(routed));
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
