// Shared fast-check generators for the necromancer-sms-gateway property tests
// (design, "Testing strategy"). Reuses router.arbitraries.ts and
// answer.arbitraries.ts. Modules built later (stopAliases.ts,
// gateway.pending.ts, gateway.key.ts, gateway.settings.ts) are not imported:
// their shapes and rules come from the design and gateway.types.ts.
import * as fc from 'fast-check';
import { ALIAS_TABLE, ROMAN_URDU_ALIASES } from './aliases.js';
import { STOP_ALIAS_LIST, STOP_MARKER } from './stopAliases.js';
import { languageArb } from './answer.arbitraries.js';
import { isCanonicalNumber, normalizeSender } from './gateway.number.js';
import type { PendingStopRecord } from './gateway.pending.js';
import type {
  CanonicalNumber,
  DayCounters,
  DeviceStatus,
  GatewaySettings,
  GatewayState,
  PartResult,
  SendReport,
} from './gateway.types.js';
import {
  anyText,
  aliasArb,
  caseMutate,
  markerArb,
  plainLatinWordArb,
  punctArb,
  urduCharArb,
} from './router.arbitraries.js';
import type { Language } from './router.types.js';
import { EMPTY_REMINDERS, type ReminderState } from './reminder.types.js';

/** Shared run settings: every gateway property runs at least 100 iterations. */
export const GATEWAY_PBT_OPTIONS = { numRuns: 100 } as const;

export { languageArb };

const DIGITS = '0123456789'.split('');
const NON_ZERO = '123456789'.split('');
const SEPARATORS: readonly string[] = [' ', '-', '.', '(', ')'];

const digitsArb = (minLength: number, maxLength: number): fc.Arbitrary<string> =>
  fc.string({ unit: fc.constantFrom(...DIGITS), minLength, maxLength });

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** A Default_Country_Code: 1 to 3 digits, the first from 1 to 9. */
export const countryCode: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(...NON_ZERO), digitsArb(0, 2))
  .map(([first, rest]) => first + rest);

/** A Canonical_Number: `+`, then 7 to 15 digits, the first from 1 to 9. */
export const canonicalNumber: fc.Arbitrary<CanonicalNumber> = fc
  .tuple(fc.constantFrom(...NON_ZERO), digitsArb(6, 14))
  .map(([first, rest]) => '+' + first + rest)
  .filter(isCanonicalNumber);

/** A Canonical_Number that starts with `cc` and has a national form (`0` + rest). */
export function canonicalNumberIn(cc: string): fc.Arbitrary<CanonicalNumber> {
  // National form `0` + rest needs 7..15 digits, so rest has 6..14 digits;
  // the canonical form `cc` + rest needs at most 15 digits.
  const maxRest = Math.min(14, 15 - cc.length);
  const minRest = Math.max(6, 7 - cc.length);
  return fc
    .tuple(fc.constantFrom(...NON_ZERO), digitsArb(minRest - 1, maxRest - 1))
    .map(([first, rest]) => '+' + cc + first + rest)
    .filter(isCanonicalNumber);
}

export type NumberFormat = 'international' | 'double-zero' | 'national';

export interface FormattedNumber {
  /** The Canonical_Number the address normalizes to with the country code. */
  readonly number: CanonicalNumber;
  /** The Sender_Address as written. */
  readonly address: string;
  readonly format: NumberFormat;
}

/** Inserts 0 to 2 separator characters between characters (never before a `+`). */
function withSeparators(plain: string): fc.Arbitrary<string> {
  const chars = Array.from(plain);
  const sepRun = fc.string({ unit: fc.constantFrom(...SEPARATORS), maxLength: 2 });
  return fc
    .array(sepRun, { minLength: chars.length, maxLength: chars.length })
    .map((seps) => chars.map((c, i) => (i === chars.length - 1 ? c : c + (seps[i] ?? ''))).join(''));
}

/** The formats of `number` that normalize back to it with `cc`. */
function formatsOf(number: CanonicalNumber, cc: string): NumberFormat[] {
  const digits = number.slice(1);
  const formats: NumberFormat[] = ['international'];
  if (digits.length + 2 <= 15) formats.push('double-zero');
  const rest = digits.slice(cc.length);
  if (digits.startsWith(cc) && /^[1-9]/.test(rest) && rest.length + 1 >= 7) {
    formats.push('national');
  }
  return formats;
}

function plainForm(number: CanonicalNumber, cc: string, format: NumberFormat): string {
  const digits = number.slice(1);
  if (format === 'international') return '+' + digits;
  if (format === 'double-zero') return '00' + digits;
  return '0' + digits.slice(cc.length);
}

/**
 * Any formatting of `number` (international `+`, `00`, or national `0` when it
 * starts with `cc`) with separators, that `normalizeSender(address, cc)`
 * maps back to `number`.
 */
export function formattingOf(number: CanonicalNumber, cc: string): fc.Arbitrary<FormattedNumber> {
  return fc
    .constantFrom(...formatsOf(number, cc))
    .chain((format) =>
      withSeparators(plainForm(number, cc, format)).map((address) => ({ number, address, format })),
    );
}

/** A number in the `cc` country written with separators, `+`, `00` or national `0`. */
export function formattedNumber(cc: string): fc.Arbitrary<FormattedNumber> {
  return fc
    .oneof(canonicalNumberIn(cc), canonicalNumber)
    .chain((number) => formattingOf(number, cc));
}

const ALPHA_SENDERS: readonly string[] = [
  'JazzCash', 'HBL-BANK', 'Telenor', 'ZONG', 'Ufone', 'EasyPaisa', 'NADRA', 'AMAZON', 'Google',
];
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * An Automated_Sender address: normalizeSender reports automated for every
 * Default_Country_Code. Covers alphanumeric IDs, short codes, too many digits,
 * a misplaced `+`, `00` followed by `0`, and the empty string.
 */
export const automatedAddress: fc.Arbitrary<string> = fc
  .oneof(
    fc.constantFrom(...ALPHA_SENDERS),
    fc
      .tuple(fc.constantFrom(...LETTERS), fc.string({ maxLength: 11 }))
      .map(([letter, rest]) => letter + rest),
    digitsArb(0, 6),
    digitsArb(16, 20).map((d) => '+' + d),
    fc.tuple(digitsArb(1, 6), digitsArb(1, 8)).map(([a, b]) => a + '+' + b),
    digitsArb(5, 11).map((d) => '000' + d),
  )
  .filter((address) => normalizeSender(address, '1').kind === 'automated')
  .filter((address) => normalizeSender(address, '999').kind === 'automated');

// ---------------------------------------------------------------------------
// Message bodies
// ---------------------------------------------------------------------------

const ALIAS_ENTRIES: readonly string[] = [...ALIAS_TABLE.keys()];

function aliasLanguage(alias: string): Language {
  if (ROMAN_URDU_ALIASES.has(alias)) return 'roman-ur';
  return /^[a-z]+$/.test(alias) ? 'en' : 'ur';
}

const ALIASES_BY_LANGUAGE: Readonly<Record<Language, readonly string[]>> = {
  en: ALIAS_ENTRIES.filter((a) => aliasLanguage(a) === 'en'),
  ur: ALIAS_ENTRIES.filter((a) => aliasLanguage(a) === 'ur'),
  'roman-ur': ALIAS_ENTRIES.filter((a) => aliasLanguage(a) === 'roman-ur'),
};

const urduWordArb: fc.Arbitrary<string> = fc.string({ unit: urduCharArb, minLength: 1, maxLength: 6 });

const WORD_BY_LANGUAGE: Readonly<Record<Language, fc.Arbitrary<string>>> = {
  en: plainLatinWordArb,
  ur: urduWordArb,
  'roman-ur': fc.oneof(markerArb, plainLatinWordArb),
};

/** Free text of 1 to 8 words in `language`. */
function freeText(language: Language): fc.Arbitrary<string> {
  const words = fc.array(WORD_BY_LANGUAGE[language], { minLength: 1, maxLength: 8 });
  if (language !== 'roman-ur') return words.map((w) => w.join(' '));
  // Roman Urdu text carries at least one marker word.
  return fc.tuple(markerArb, words).map(([marker, w]) => [marker, ...w].join(' '));
}

/** A command body: an alias of `language` (case changed) with an optional argument. */
function commandBody(language: Language): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.constantFrom(...ALIASES_BY_LANGUAGE[language]).chain(caseMutate),
      fc.option(freeText(language), { nil: undefined }),
    )
    .map(([alias, arg]) => (arg === undefined ? alias : alias + ' ' + arg));
}

/** A message body in `language`, built from router aliases and free text. */
export function body(language: Language): fc.Arbitrary<string> {
  return fc.oneof(commandBody(language), freeText(language));
}

/** A message body in any Language, or any router alias, or arbitrary text. */
export const anyBody: fc.Arbitrary<string> = fc.oneof(
  languageArb.chain(body),
  aliasArb,
  anyText,
);

// ---------------------------------------------------------------------------
// Settings and state
// ---------------------------------------------------------------------------

/** A receive or current time in ms since the Unix epoch (2020 to 2035). */
export const timeArb: fc.Arbitrary<number> = fc.integer({
  min: 1_577_836_800_000,
  max: 2_082_758_400_000,
});

/** Valid Gateway_Settings within the ranges 1–60, 1–1440 and 1–2000. */
export const settings: fc.Arbitrary<GatewaySettings> = fc.record({
  allowlistMode: fc.boolean(),
  perNumberLimit: fc.integer({ min: 1, max: 60 }),
  rateWindowMinutes: fc.integer({ min: 1, max: 1440 }),
  dailySendCap: fc.integer({ min: 1, max: 2000 }),
  defaultCountryCode: countryCode,
  ownNumber: fc.option(canonicalNumber, { nil: null }),
});

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A local day key 'YYYY-MM-DD'. */
export const dayKeyArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 2020, max: 2035 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${String(y)}-${pad2(m)}-${pad2(d)}`);

/** Day counters with `handed` from 0 up to and including `cap`. */
export function dayCounters(cap: number): fc.Arbitrary<DayCounters> {
  const count = fc.integer({ min: 0, max: 5000 });
  return fc.record({
    dayKey: dayKeyArb,
    received: count,
    repliesSent: count,
    replied: count,
    partsSent: count,
    ignored: count,
    handed: fc.oneof(fc.integer({ min: 0, max: cap }), fc.constant(cap)),
  });
}

const sortedTimes: fc.Arbitrary<readonly number[]> = fc
  .array(timeArb, { maxLength: 6 })
  .map((times) => [...times].sort((a, b) => a - b));

/**
 * A Gateway_State. Numbers are drawn from `pool` (when given) and random
 * Canonical_Numbers, so a test's sender can appear on any list.
 * `reminders` defaults to `EMPTY_REMINDERS`; pass e.g. `reminderStore(pool)` to vary it.
 */
export function gatewayState(
  pool: readonly CanonicalNumber[] = [],
  reminders: fc.Arbitrary<ReminderState> = fc.constant(EMPTY_REMINDERS),
): fc.Arbitrary<GatewayState> {
  const numberArb =
    pool.length > 0 ? fc.oneof(fc.constantFrom(...pool), canonicalNumber) : canonicalNumber;
  const numbers = fc.array(numberArb, { maxLength: 8 });
  return settings.chain((s) =>
    fc
      .record({
        stopList: numbers,
        allowlist: fc.oneof(
          { arbitrary: numbers, weight: 4 },
          { arbitrary: fc.constant('unreadable' as const), weight: 1 },
        ),
        rate: fc.array(fc.tuple(numberArb, sortedTimes), { maxLength: 6 }),
        slowDown: fc.array(fc.tuple(numberArb, timeArb), { maxLength: 4 }),
        counters: dayCounters(s.dailySendCap),
        reminders,
      })
      .map(
        (r): GatewayState => ({
          stopList: new Set(r.stopList),
          allowlist: r.allowlist === 'unreadable' ? 'unreadable' : new Set(r.allowlist),
          rate: new Map(r.rate),
          slowDown: new Map(r.slowDown),
          counters: r.counters,
          settings: s,
          reminders: r.reminders,
        }),
      ),
  );
}

// ---------------------------------------------------------------------------
// Device status and send reports
// ---------------------------------------------------------------------------

/** Any Device_Status. */
export const deviceStatus: fc.Arbitrary<DeviceStatus> = fc.record({
  smsPermission: fc.boolean(),
  notificationPermission: fc.boolean(),
  batteryOptimisationIgnored: fc.boolean(),
  inService: fc.boolean(),
  airplaneMode: fc.boolean(),
});

const PART_RESULTS: readonly PartResult[] = ['sent', 'failed-radio', 'failed-no-service', 'failed-other'];

/** A Send_Report for `partCount` parts (1 to 4 when omitted). */
export function sendReport(partCount?: number): fc.Arbitrary<SendReport> {
  const count = partCount ?? 0;
  const results =
    partCount === undefined
      ? fc.array(fc.constantFrom(...PART_RESULTS), { minLength: 1, maxLength: 4 })
      : fc.array(fc.constantFrom(...PART_RESULTS), { minLength: count, maxLength: count });
  const done = fc.record({
    status: fc.constant('done' as const),
    results,
    attempts: fc.constantFrom<1 | 2>(1, 2),
  });
  return fc.oneof(
    { arbitrary: done, weight: 4 },
    { arbitrary: fc.constant({ status: 'refused-stopped' as const }), weight: 1 },
    { arbitrary: fc.constant({ status: 'cancelled' as const }), weight: 1 },
  );
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

const KEY_CHARS = [...LETTERS, ...DIGITS, '_', '-'];

/** A valid Gemini_Api_Key: matches /^[A-Za-z0-9_-]{30,64}$/. */
export const apiKey: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(...KEY_CHARS),
  minLength: 30,
  maxLength: 64,
});

// ---------------------------------------------------------------------------
// STOP aliases and Pending_Stop_Records
// ---------------------------------------------------------------------------


const STOP_ALIASES: readonly string[] = STOP_ALIAS_LIST;

const leadWs = fc.string({ unit: fc.constantFrom(' ', '\t', '\n'), maxLength: 3 });
const sepWs = fc.string({ unit: fc.constantFrom(' ', '\t', '\n'), minLength: 1, maxLength: 3 });

/**
 * A plain STOP form: leading whitespace, a STOP alias with any letter case,
 * 0 to 3 trailing punctuation characters, and an optional whitespace-separated tail.
 */
export const stopAliasBody: fc.Arbitrary<string> = fc
  .tuple(
    leadWs,
    fc.constantFrom(...STOP_ALIASES).chain(caseMutate),
    punctArb,
    fc.option(fc.tuple(sepWs, anyText), { nil: undefined }),
  )
  .map(([lead, alias, punct, tail]) =>
    lead + alias + punct + (tail === undefined ? '' : tail[0] + tail[1]),
  );

/**
 * A Pending_Stop_Record whose sender is an Automated_Sender, a formatting of
 * `ownNumber` (when set) or another Phone_Number, formatted for `cc`.
 */
export function pendingStopRecord(
  ownNumber: CanonicalNumber | null,
  cc: string,
): fc.Arbitrary<PendingStopRecord> {
  const others = canonicalNumber
    .filter((n) => n !== ownNumber)
    .chain((n) => formattingOf(n, cc))
    .map((f) => f.address);
  const senders: fc.Arbitrary<string>[] = [automatedAddress, others];
  if (ownNumber !== null) senders.push(formattingOf(ownNumber, cc).map((f) => f.address));
  return fc.record({
    id: fc.nat(),
    sender: fc.oneof(...senders),
    marker: fc.constant(STOP_MARKER),
    receivedAt: timeArb,
  });
}
