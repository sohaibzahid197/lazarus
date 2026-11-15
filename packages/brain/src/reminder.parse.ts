// Time_Parser (sms-reminders design, "Time_Parser"; Requirement 2).
// Pure: no clock, no state, no throw. Reads the leading Time_Expression of a
// REMIND argument and slices the Reminder_Text from the original argument.
import {
  REMINDER_TEXT_MAX,
  type DayPeriod,
  type DayWord,
  type DurationUnit,
  type ParseResult,
  type TimeExpression,
} from './reminder.types.js';

interface Token {
  /** Token text lowercased, for Latin-script matching (2.1). */
  readonly word: string;
  /** Offset in the argument just after the token. */
  readonly end: number;
}

interface Step<T> {
  readonly value: T;
  /** Index of the next unread token. */
  readonly next: number;
}

interface HourMinute {
  readonly hour: number;
  readonly minute: number;
}

/** No expression is longer than 8 tokens, so a few more are enough. */
const MAX_TOKENS = 12;
const D = '[0-9\u06F0-\u06F9]';
const DIGITS = new RegExp(`^${D}+$`);
const CLOCK12_ONE = new RegExp(`^(${D}{1,2})(?:[:.](${D}{2}))?(am|pm)$`);
const BARE = new RegExp(`^(${D}{1,2})(?:[:.](${D}{2}))?$`);
const CLOCK24 = new RegExp(`^(${D}{1,2}):(${D}{2})$`);
const TIME_LIKE = new RegExp(`^${D}+(?:[:.]${D}+)?(?:am|pm)?$`);
const AM_PM: ReadonlySet<string> = new Set(['am', 'pm']);
const FILLERS: ReadonlySet<string> = new Set(['at', 'ko', 'baje', 'کو', 'بجے']);
const BAAD: ReadonlySet<string> = new Set(['baad', 'بعد']);

const DAY_WORDS: ReadonlyMap<string, DayWord> = new Map([
  ['today', 'today'],
  ['aaj', 'today'],
  ['آج', 'today'],
  ['tomorrow', 'tomorrow'],
  ['kal', 'tomorrow'],
  ['کل', 'tomorrow'],
]);

const PERIODS: ReadonlyMap<string, DayPeriod> = new Map([
  ['morning', 'morning'],
  ['subah', 'morning'],
  ['صبح', 'morning'],
  ['evening', 'evening'],
  ['shaam', 'evening'],
  ['شام', 'evening'],
  ['night', 'night'],
  ['raat', 'night'],
  ['رات', 'night'],
]);

const UNITS_EN: ReadonlyMap<string, DurationUnit> = new Map([
  ['minute', 'minute'],
  ['minutes', 'minute'],
  ['min', 'minute'],
  ['mins', 'minute'],
  ['hour', 'hour'],
  ['hours', 'hour'],
  ['hr', 'hour'],
  ['hrs', 'hour'],
  ['day', 'day'],
  ['days', 'day'],
]);

const UNITS_UR: ReadonlyMap<string, DurationUnit> = new Map([
  ['minute', 'minute'],
  ['ghante', 'hour'],
  ['ghanta', 'hour'],
  ['din', 'day'],
  ['منٹ', 'minute'],
  ['گھنٹے', 'hour'],
  ['گھنٹہ', 'hour'],
  ['دن', 'day'],
]);

/** Bare-hour range after a Day_Period and the hours added (2.6). */
const PERIOD_RANGE: Readonly<Record<DayPeriod, { min: number; max: number; add: number }>> = {
  morning: { min: 1, max: 12, add: 0 },
  evening: { min: 1, max: 11, add: 12 },
  night: { min: 6, max: 11, add: 12 },
};

/**
 * Value of a string of ASCII and Extended Arabic-Indic digits (2.1), or NaN
 * when the string is empty or holds any other character.
 */
export function toDigitValue(digits: string): number {
  if (!DIGITS.test(digits)) return Number.NaN;
  let value = 0;
  for (const ch of digits) {
    const code = ch.charCodeAt(0);
    value = value * 10 + (code >= 0x06f0 ? code - 0x06f0 : code - 0x30);
  }
  return value;
}

/** Whitespace-separated tokens with end offsets (2.2). */
function tokenize(argument: string): readonly Token[] {
  const tokens: Token[] = [];
  const re = /[^ \t\n]+/g;
  let m = re.exec(argument);
  while (m !== null && tokens.length < MAX_TOKENS) {
    tokens.push({ word: m[0].toLowerCase(), end: m.index + m[0].length });
    m = re.exec(argument);
  }
  return tokens;
}

const wordAt = (tokens: readonly Token[], i: number): string => tokens[i]?.word ?? '';

/** Skips at most one Filler_Word at position i (2.11). */
const skipFiller = (tokens: readonly Token[], i: number): number =>
  FILLERS.has(wordAt(tokens, i)) ? i + 1 : i;

function minuteOf(group: string | undefined): number {
  return group === undefined ? 0 : toDigitValue(group);
}

function to24(hour12: number, minute: number, suffix: string): HourMinute | null {
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const base = hour12 === 12 ? 0 : hour12;
  return { hour: suffix === 'pm' ? base + 12 : base, minute };
}

/** `8pm`, `8:30pm`, `8.30pm`, `8 pm`, `8:30 pm` (2.3). */
function readClock12(tokens: readonly Token[], i: number): Step<HourMinute> | null {
  const word = wordAt(tokens, i);
  const one = CLOCK12_ONE.exec(word);
  if (one !== null) {
    const hm = to24(toDigitValue(one[1] ?? ''), minuteOf(one[2]), one[3] ?? '');
    return hm === null ? null : { value: hm, next: i + 1 };
  }
  const bare = BARE.exec(word);
  const suffix = wordAt(tokens, i + 1);
  if (bare === null || !AM_PM.has(suffix)) return null;
  const hm = to24(toDigitValue(bare[1] ?? ''), minuteOf(bare[2]), suffix);
  return hm === null ? null : { value: hm, next: i + 2 };
}

/** `H:MM` / `HH:MM`, hour 0–23, not followed by `am`/`pm` (2.4). */
function readClock24(tokens: readonly Token[], i: number): Step<HourMinute> | null {
  const m = CLOCK24.exec(wordAt(tokens, i));
  if (m === null || AM_PM.has(wordAt(tokens, i + 1))) return null;
  const hour = toDigitValue(m[1] ?? '');
  const minute = toDigitValue(m[2] ?? '');
  return hour > 23 || minute > 59 ? null : { value: { hour, minute }, next: i + 1 };
}

/** A token that looks like a time (`8`, `8:30`, `25`, `8pm`). */
const isTimeLike = (word: string): boolean => TIME_LIKE.test(word);

/** Bare `H`, `H:MM` or `H.MM` in the period's range (2.5, 2.6). */
function readBareHour(
  tokens: readonly Token[],
  i: number,
  period: DayPeriod,
): Step<HourMinute> | null {
  const m = BARE.exec(wordAt(tokens, i));
  if (m === null) return null;
  const hour = toDigitValue(m[1] ?? '');
  const minute = minuteOf(m[2]);
  const range = PERIOD_RANGE[period];
  if (hour < range.min || hour > range.max || minute > 59) return null;
  return { value: { hour: hour + range.add, minute }, next: i + 1 };
}

type DaylessExpr = (day: DayWord | null) => TimeExpression;

/** Clock after a Day_Period: am/pm or hour 0 / 13–23 drops the period (2.7). */
function readPeriodClock(
  tokens: readonly Token[],
  i: number,
  period: DayPeriod,
): Step<DaylessExpr> | null {
  const clock12 = readClock12(tokens, i);
  if (clock12 !== null) return { value: clockExpr(clock12.value, null), next: clock12.next };
  const clock24 = readClock24(tokens, i);
  if (clock24 !== null && (clock24.value.hour === 0 || clock24.value.hour >= 13)) {
    return { value: clockExpr(clock24.value, null), next: clock24.next };
  }
  const bare = readBareHour(tokens, i, period);
  return bare === null ? null : { value: clockExpr(bare.value, period), next: bare.next };
}

function clockExpr(hm: HourMinute, period: DayPeriod | null): DaylessExpr {
  return (day) => ({ kind: 'clock', day, period, hour: hm.hour, minute: hm.minute });
}

/** `period F? periodClock?`; a time-like token out of range is `no-time` (2.8, 2.12). */
function readPeriod(tokens: readonly Token[], i: number): Step<DaylessExpr> | null {
  const period = PERIODS.get(wordAt(tokens, i));
  if (period === undefined) return null;
  const at = skipFiller(tokens, i + 1);
  const clock = readPeriodClock(tokens, at, period);
  if (clock !== null) return clock;
  if (isTimeLike(wordAt(tokens, at))) return null;
  return { value: (day) => ({ kind: 'period', day, period }), next: i + 1 };
}

/** `clock12 | clock24 | period F? periodClock?`. */
function readClockPart(tokens: readonly Token[], i: number): Step<DaylessExpr> | null {
  const clock = readClock12(tokens, i) ?? readClock24(tokens, i);
  if (clock !== null) return { value: clockExpr(clock.value, null), next: clock.next };
  return readPeriod(tokens, i);
}

/** N with 1 to 6 digits and value 1 to 999,999 (2.10). */
function readAmount(word: string): number | null {
  if (word.length > 6) return null;
  const n = toDigitValue(word);
  return Number.isNaN(n) || n < 1 ? null : n;
}

/** `in N unitEn` or `N unitUr baad` (2.10). */
function readRelative(tokens: readonly Token[], i: number): Step<TimeExpression> | null {
  const first = wordAt(tokens, i);
  const inForm = first === 'in';
  const amount = readAmount(wordAt(tokens, inForm ? i + 1 : i));
  if (amount === null) return null;
  const unitAt = inForm ? i + 2 : i + 1;
  const unit = (inForm ? UNITS_EN : UNITS_UR).get(wordAt(tokens, unitAt));
  if (unit === undefined) return null;
  if (!inForm && !BAAD.has(wordAt(tokens, unitAt + 1))) return null;
  return { value: { kind: 'relative', amount, unit }, next: inForm ? unitAt + 1 : unitAt + 2 };
}

/** `F? dayWord? F? clockPart`. */
function readDayClock(tokens: readonly Token[], i: number): Step<TimeExpression> | null {
  const day = DAY_WORDS.get(wordAt(tokens, i)) ?? null;
  const at = day === null ? i : skipFiller(tokens, i + 1);
  const part = readClockPart(tokens, at);
  return part === null ? null : { value: part.value(day), next: part.next };
}

/** Longest leading Time_Expression, with leading and trailing Filler_Words. */
function readExpression(tokens: readonly Token[]): Step<TimeExpression> | null {
  const start = skipFiller(tokens, 0);
  const expr = readRelative(tokens, start) ?? readDayClock(tokens, start);
  return expr === null ? null : { value: expr.value, next: skipFiller(tokens, expr.next) };
}

/** Time_Parser: Time_Expression and Reminder_Text, or a Parse_Error (Requirement 2). */
export function parseReminder(argument: string): ParseResult {
  const tokens = tokenize(argument);
  const expr = readExpression(tokens);
  if (expr === null) return { ok: false, error: 'no-time' };
  const end = tokens[expr.next - 1]?.end ?? 0;
  const text = argument.slice(end).trim();
  if (text.length === 0) return { ok: false, error: 'no-text' };
  // UTF-16 code units, so each emoji outside the BMP counts as 2 (2.15).
  if (text.length > REMINDER_TEXT_MAX) return { ok: false, error: 'text-too-long' };
  return { ok: true, expr: expr.value, text };
}
