// Shared fast-check generators for the sms-reminders property tests
// (design, "Testing strategy"). Test-only: not exported from index.ts.
// Reuses gateway.arbitraries.ts and router.arbitraries.ts. Modules built
// later (reminder.parse.ts, reminder.print.ts, reminder.pipeline.ts) are not
// imported: their rules come from the requirements and reminder.types.ts.
import * as fc from 'fast-check';
import { canonicalNumber, languageArb } from './gateway.arbitraries.js';
import type { CanonicalNumber } from './gateway.types.js';
import { urduCharArb } from './router.arbitraries.js';
import {
  REMINDER_HORIZON_MS,
  REMINDER_LIMIT,
  REMINDER_TEXT_MAX,
  type DayPeriod,
  type DayWord,
  type DurationUnit,
  type Reminder,
  type ReminderId,
  type ReminderSlot,
  type ReminderState,
  type TimeExpression,
} from './reminder.types.js';

/** Shared run settings: every reminder property runs at least 100 iterations. */
export const REMINDER_PBT_OPTIONS = { numRuns: 100 } as const;

// ---------------------------------------------------------------------------
// Time_Expressions (Requirement 4.4: valid values only)
// ---------------------------------------------------------------------------

const dayWordArb: fc.Arbitrary<DayWord | null> = fc.constantFrom<DayWord | null>(
  null,
  'today',
  'tomorrow',
);
const DAY_PERIODS: readonly DayPeriod[] = ['morning', 'evening', 'night'];
const DURATION_UNITS: readonly DurationUnit[] = ['minute', 'hour', 'day'];
const minuteArb = fc.integer({ min: 0, max: 59 });

/** 24-hour hours a bare hour after each Day_Period can give (Requirement 2.6). */
const PERIOD_HOURS: Readonly<Record<DayPeriod, { readonly min: number; readonly max: number }>> = {
  morning: { min: 1, max: 12 },
  evening: { min: 13, max: 23 },
  night: { min: 18, max: 23 },
};

const plainClock: fc.Arbitrary<TimeExpression> = fc.record({
  kind: fc.constant('clock' as const),
  day: dayWordArb,
  period: fc.constant(null),
  hour: fc.integer({ min: 0, max: 23 }),
  minute: minuteArb,
});

const periodClock: fc.Arbitrary<TimeExpression> = fc
  .constantFrom(...DAY_PERIODS)
  .chain((period) =>
    fc.record({
      kind: fc.constant('clock' as const),
      day: dayWordArb,
      period: fc.constant(period),
      hour: fc.integer(PERIOD_HOURS[period]),
      minute: minuteArb,
    }),
  );

const periodAlone: fc.Arbitrary<TimeExpression> = fc.record({
  kind: fc.constant('period' as const),
  day: dayWordArb,
  period: fc.constantFrom(...DAY_PERIODS),
});

const relative: fc.Arbitrary<TimeExpression> = fc.record({
  kind: fc.constant('relative' as const),
  amount: fc.oneof(fc.integer({ min: 1, max: 999_999 }), fc.integer({ min: 1, max: 60 })),
  unit: fc.constantFrom(...DURATION_UNITS),
});

/** Any valid Time_Expression: exactly the values the Time_Parser can return. */
export const timeExpression: fc.Arbitrary<TimeExpression> = fc.oneof(
  plainClock,
  periodClock,
  periodAlone,
  relative,
);

// ---------------------------------------------------------------------------
// Reminder_Texts
// ---------------------------------------------------------------------------

const LATIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const ASCII_DIGITS = '0123456789'.split('');
/** Single code point emoji: most are outside the BMP (2 UTF-16 units), ⏰ and ✅ are 1. */
const EMOJI: readonly string[] = ['😀', '👍', '🙏', '🌙', '💊', '⏰', '✅'];

const textUnit: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constantFrom(...LATIN), weight: 4 },
  { arbitrary: urduCharArb, weight: 3 },
  { arbitrary: fc.constantFrom(...ASCII_DIGITS), weight: 1 },
  { arbitrary: fc.constantFrom(...EMOJI), weight: 1 },
  { arbitrary: fc.constant(' '), weight: 2 },
);

/** Joins units, stopping before the one that would pass the UTF-16 limit. */
function joinWithinLimit(units: readonly string[]): string {
  let text = '';
  for (const unit of units) {
    if (text.length + unit.length > REMINDER_TEXT_MAX) break;
    text += unit;
  }
  return text;
}

/**
 * A Reminder_Text: 1 to 140 UTF-16 code units of Latin letters, Urdu script,
 * ASCII digits, emoji and spaces, with no leading or trailing whitespace.
 * Long draws are cut at the limit, so emoji-heavy texts still reach it.
 */
export const reminderText: fc.Arbitrary<string> = fc
  .oneof(
    fc.array(textUnit, { minLength: 1, maxLength: REMINDER_TEXT_MAX }),
    fc.array(textUnit, { minLength: 1, maxLength: REMINDER_TEXT_MAX, size: 'max' }),
  )
  .map((units) => joinWithinLimit(units).trim())
  .filter((text) => text.length > 0 && text.length <= REMINDER_TEXT_MAX);

/**
 * First tokens a Reminder_Text may not start with in the round trip of
 * Requirement 4.2: Filler_Words, Day_Words, Day_Periods, `am`, `pm`,
 * Relative_Duration unit words, `baad` and `بعد`. Latin entries are lowercase.
 */
const RESERVED_FIRST_TOKENS: ReadonlySet<string> = new Set([
  // Filler_Words
  'at', 'ko', 'baje', 'کو', 'بجے',
  // Day_Words
  'today', 'aaj', 'آج', 'tomorrow', 'kal', 'کل',
  // Day_Periods
  'morning', 'subah', 'صبح', 'evening', 'shaam', 'شام', 'night', 'raat', 'رات',
  'am', 'pm',
  // Relative_Duration units (English and Urdu forms)
  'minute', 'minutes', 'min', 'mins', 'hour', 'hours', 'hr', 'hrs', 'day', 'days',
  'ghante', 'ghanta', 'din', 'منٹ', 'گھنٹے', 'گھنٹہ', 'دن',
  'baad', 'بعد',
]);

const DIGIT_LED = /^[0-9\u06F0-\u06F9]/;

/** True when the first whitespace-separated token of `text` is allowed by Requirement 4.2. */
export function hasPrintableFirstToken(text: string): boolean {
  const first = text.split(/[ \t\n]+/)[0] ?? '';
  return !DIGIT_LED.test(first) && !RESERVED_FIRST_TOKENS.has(first.toLowerCase());
}

/** A Reminder_Text that satisfies the first-token filter of Property 9. */
export const printableReminderText: fc.Arbitrary<string> = reminderText.filter(hasPrintableFirstToken);

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/** A receive time: integer ms from 0 to 2100-01-01T00:00:00.000Z (Requirement 3.8). */
export const receiveTime: fc.Arbitrary<number> = fc.integer({ min: 0, max: 4_102_444_800_000 });

// ---------------------------------------------------------------------------
// Reminders and Reminder_Stores
// ---------------------------------------------------------------------------

const SLOTS: readonly ReminderSlot[] = [1, 2, 3, 4, 5];

const isReminderId = (id: string): id is ReminderId => id.startsWith('r:');

/** A Reminder_Id `r:<messageId>`. */
const reminderIdArb: fc.Arbitrary<ReminderId> = fc
  .string({ unit: fc.constantFrom(...ASCII_DIGITS, ...LATIN, '-', '_'), minLength: 1, maxLength: 12 })
  .map((messageId) => 'r:' + messageId)
  .filter(isReminderId);

function reminderWith(
  id: fc.Arbitrary<ReminderId>,
  number: fc.Arbitrary<CanonicalNumber>,
  slot: fc.Arbitrary<ReminderSlot>,
): fc.Arbitrary<Reminder> {
  return fc
    .record({
      id,
      number,
      slot,
      createdAt: receiveTime,
      delay: fc.integer({ min: 1, max: REMINDER_HORIZON_MS }),
      text: reminderText,
      language: languageArb,
      handed: fc.option(fc.integer({ min: 0, max: REMINDER_HORIZON_MS }), { nil: null, freq: 4 }),
    })
    .map(
      (r): Reminder => ({
        id: r.id,
        number: r.number,
        slot: r.slot,
        dueAt: r.createdAt + r.delay,
        text: r.text,
        language: r.language,
        createdAt: r.createdAt,
        handedAt: r.handed === null ? null : r.createdAt + r.delay + r.handed,
      }),
    );
}

/** One Reminder with Due_Time 1 ms to 30 days after its creation time. */
export const reminder: fc.Arbitrary<Reminder> = reminderWith(
  reminderIdArb,
  canonicalNumber,
  fc.constantFrom(...SLOTS),
);

/**
 * A readable Reminder_Store. Numbers come from `pool` (when given) and random
 * Canonical_Numbers; each number has at most 5 Reminders, each in its own slot,
 * and every Reminder_Id is unique.
 */
export function reminderStore(pool: readonly CanonicalNumber[] = []): fc.Arbitrary<ReminderState> {
  const numberArb =
    pool.length > 0 ? fc.oneof(fc.constantFrom(...pool), canonicalNumber) : canonicalNumber;
  const perNumber = (number: CanonicalNumber): fc.Arbitrary<Reminder[]> =>
    fc
      .subarray([...SLOTS], { minLength: 0, maxLength: REMINDER_LIMIT })
      .chain((slots) =>
        fc.tuple(
          ...slots.map((slot) => reminderWith(reminderIdArb, fc.constant(number), fc.constant(slot))),
        ),
      );
  return fc
    .uniqueArray(numberArb, { maxLength: 4 })
    .chain((numbers) => fc.tuple(...numbers.map(perNumber)))
    .chain((groups) => fc.shuffledSubarray(groups.flat(), { minLength: groups.flat().length }))
    .map(
      (reminders): ReminderState => ({
        status: 'ok',
        // A unique suffix keeps ids distinct while their order stays random.
        reminders: reminders.map((r, i) => {
          const id = `${r.id}-${String(i)}`;
          return isReminderId(id) ? { ...r, id } : r;
        }),
      }),
    );
}

// ---------------------------------------------------------------------------
// Surface variants (Property 6) and slot spellings (Property 23)
// ---------------------------------------------------------------------------

const ARABIC_INDIC_ZERO = 0x06f0;
const WS_UNITS: readonly string[] = [' ', '\t', '\n'];

const toArabicIndic = (digit: string): string =>
  String.fromCharCode(ARABIC_INDIC_ZERO + Number(digit));

function charVariant(c: string): fc.Arbitrary<string> {
  if (/^[A-Za-z]$/.test(c)) return fc.constantFrom(c.toLowerCase(), c.toUpperCase());
  if (/^[0-9]$/.test(c)) return fc.constantFrom(c, toArabicIndic(c));
  if (c === ' ') return fc.string({ unit: fc.constantFrom(...WS_UNITS), minLength: 1, maxLength: 4 });
  return fc.constant(c);
}

/**
 * A surface variant of a printed Time_Expression (Property 6): each Latin
 * letter in either case, each ASCII digit as itself or the Extended
 * Arabic-Indic digit of the same value, and each single space as a run of
 * 1 to 4 spaces, tabs and newlines. Filler_Word insertion is left to the test,
 * which knows the expression structure.
 */
export function surfaceVariant(text: string): fc.Arbitrary<string> {
  const chars = Array.from(text);
  if (chars.length === 0) return fc.constant('');
  return fc.tuple(...chars.map(charVariant)).map((parts) => parts.join(''));
}

/**
 * A 1 to 3 character spelling of `n` (0 to 999) in base 10 with optional
 * leading zeros, each digit ASCII or Extended Arabic-Indic (Property 23).
 */
export function slotSpelling(n: number): fc.Arbitrary<string> {
  const plain = String(n);
  return fc
    .integer({ min: plain.length, max: 3 })
    .chain((width) => {
      const digits = Array.from(plain.padStart(width, '0'));
      return fc.tuple(...digits.map((d) => fc.constantFrom(d, toArabicIndic(d))));
    })
    .map((parts) => parts.join(''));
}
