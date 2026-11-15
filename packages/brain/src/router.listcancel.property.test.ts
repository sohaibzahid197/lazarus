import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeMessage } from './normalize.js';
import { routeCommand } from './router.js';
import type { RoutedCommand } from './router.types.js';
import { REMINDER_PBT_OPTIONS } from './reminder.arbitraries.js';
import { cancelAliasArb, caseMutate, listAliasArb, punctArb, wsArb } from './router.arbitraries.js';

const ASCII_DIGITS = '0123456789'.split('');
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹'.split('');
const ALLOWED_DIGITS: ReadonlySet<string> = new Set([...ASCII_DIGITS, ...URDU_DIGITS]);

const digitArb = fc.constantFrom(...ASCII_DIGITS, ...URDU_DIGITS);
const digitsArb = (min: number, max: number): fc.Arbitrary<string> =>
  fc.string({ unit: digitArb, minLength: min, maxLength: max });

/** Trailing text of 1 to 500 characters with at least 1 non-whitespace character (Requirement 1.12). */
const generalTail: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 500 }),
  fc.string({ minLength: 1, maxLength: 500, unit: 'binary' }),
);

/** Tails near the CANCEL boundary: valid slots, too long, punctuated, two tokens, padded with whitespace. */
const nearSlotTail: fc.Arbitrary<string> = fc.oneof(
  digitsArb(1, 3),
  digitsArb(4, 6),
  fc.tuple(digitsArb(1, 3), fc.constantFrom('.', ',', '!', '?', 'a', 'ب')).map(([d, p]) => d + p),
  fc.tuple(digitsArb(1, 3), wsArb, digitsArb(1, 3)).map(([a, ws, b]) => a + ws + b),
  fc.tuple(wsArb, digitsArb(1, 3), wsArb).map(([a, d, b]) => a + d + b),
  fc.constantFrom('１', '٢', '2.', 'two', '0', '۰۰۰', '1۲3'),
);

const tailArb: fc.Arbitrary<string> = fc
  .oneof(generalTail, nearSlotTail)
  .filter((t) => t.length >= 1 && t.length <= 500 && /\S/u.test(t));

type Kind = 'LIST' | 'CANCEL';

const messageArb: fc.Arbitrary<{ kind: Kind; message: string }> = fc
  .tuple(
    fc.oneof(
      listAliasArb.map((a) => ({ kind: 'LIST' as const, alias: a })),
      cancelAliasArb.map((a) => ({ kind: 'CANCEL' as const, alias: a })),
    ),
    punctArb,
    wsArb,
    // Empty tail covers bare LIST / CANCEL (Requirements 1.2, 1.6); otherwise the 1.12 tail.
    fc.oneof({ arbitrary: fc.constant(''), weight: 1 }, { arbitrary: tailArb, weight: 6 }),
  )
  .chain(([{ kind, alias }, punct, ws, tail]) =>
    caseMutate(alias).map((kw) => ({ kind, message: `${kw}${punct}${ws}${tail}` })),
  );

/** Independent oracle on the Normalized_Message (Requirements 1.2 to 1.6). */
function expected(kind: Kind, message: string): Omit<RoutedCommand, 'language'> {
  const text = normalizeMessage(message);
  const space = text.indexOf(' ');
  const rest = space === -1 ? '' : text.slice(space + 1);
  const question = { command: 'QUESTION' as const, argument: text, argumentMissing: false };
  if (kind === 'LIST') {
    return rest === '' ? { command: 'LIST', argument: '', argumentMissing: false } : question;
  }
  if (rest === '') return { command: 'CANCEL', argument: '', argumentMissing: true };
  const chars = Array.from(rest);
  const isSlot = chars.length >= 1 && chars.length <= 3 && chars.every((c) => ALLOWED_DIGITS.has(c));
  return isSlot ? { command: 'CANCEL', argument: rest, argumentMissing: false } : question;
}

// Feature: sms-reminders, Property 1: LIST and CANCEL route only in their strict form
describe('Property 1: LIST and CANCEL route only in their strict form', () => {
  /**
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.12**
   */
  it('1.12 LIST + text routes to QUESTION; CANCEL + text routes to CANCEL only for a 1-3 digit token', () => {
    fc.assert(
      fc.property(messageArb, ({ kind, message }) => {
        const r = routeCommand(message);
        const want = expected(kind, message);
        expect({ command: r.command, argument: r.argument, argumentMissing: r.argumentMissing }).toEqual(want);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });

});
