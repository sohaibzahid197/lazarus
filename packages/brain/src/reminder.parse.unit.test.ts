// Unit tests for the Time_Parser: examples and boundaries.
// Inputs are the REMIND argument (no `REMIND` keyword).
// _Requirements: 2.2, 2.7, 2.8, 2.11, 2.12, 2.14, 2.15, 14.3, 14.4_
import { describe, it, expect } from 'vitest';
import { parseReminder } from './reminder.parse.js';
import { resolveDueTime } from './reminder.resolve.js';
import { REMINDER_TEXT_MAX } from './reminder.types.js';

// 2025-01-15 10:00:00 Pakistan_Time.
const RECEIVED_AT = Date.UTC(2025, 0, 15, 5, 0, 0, 0);
// 2025-01-15 18:00 Pakistan_Time.
const JAN_15_18_PK = Date.UTC(2025, 0, 15, 13, 0, 0, 0);

describe('parseReminder: Day_Period and Clock_Time (2.7, 2.8)', () => {
  it('reads `subah 8pm x` as 20:00 with no Day_Period', () => {
    expect(parseReminder('subah 8pm x')).toEqual({
      ok: true,
      expr: { kind: 'clock', day: null, period: null, hour: 20, minute: 0 },
      text: 'x',
    });
  });

  it('reads `shaam x` as the evening period, which resolves to 18:00', () => {
    const result = parseReminder('shaam x');
    expect(result).toEqual({
      ok: true,
      expr: { kind: 'period', day: null, period: 'evening' },
      text: 'x',
    });
    if (!result.ok) return;
    expect(resolveDueTime(result.expr, RECEIVED_AT)).toEqual({ ok: true, dueAt: JAN_15_18_PK });
  });
});

describe('parseReminder: Filler_Words (2.11)', () => {
  it('reads `shaam ko 6 baje x` as 18:00 keeping the evening period', () => {
    expect(parseReminder('shaam ko 6 baje x')).toEqual({
      ok: true,
      expr: { kind: 'clock', day: null, period: 'evening', hour: 18, minute: 0 },
      text: 'x',
    });
  });

  it('reads `at 8pm x` as 20:00', () => {
    expect(parseReminder('at 8pm x')).toEqual({
      ok: true,
      expr: { kind: 'clock', day: null, period: null, hour: 20, minute: 0 },
      text: 'x',
    });
  });
});

describe('parseReminder: whole-token matching (2.2)', () => {
  it.each(['kalam 8pm x', 'subahdam x', '8pmx y'])('`%s` gives no-time', (argument) => {
    expect(parseReminder(argument)).toEqual({ ok: false, error: 'no-time' });
  });
});

describe('parseReminder: no-time (2.12)', () => {
  it.each([
    '13pm x',
    '20:00pm x',
    'kal x',
    'raat 3 x',
    'in 0 hours x',
    'in 1234567 minutes x',
    '9 take medicine',
  ])('`%s` gives no-time', (argument) => {
    expect(parseReminder(argument)).toEqual({ ok: false, error: 'no-time' });
  });
});

describe('parseReminder: Reminder_Text (2.14, 2.15)', () => {
  it('`8pm` with no text gives no-text', () => {
    expect(parseReminder('8pm')).toEqual({ ok: false, error: 'no-text' });
  });

  it('`8pm` followed by only whitespace gives no-text', () => {
    expect(parseReminder('8pm  \t\n ')).toEqual({ ok: false, error: 'no-text' });
  });

  // The limit is in UTF-16 code units: each emoji outside the BMP counts as 2.
  const emoji140 = '😀'.repeat(70);
  const urdu140 = 'د'.repeat(140);
  const at8pm = { kind: 'clock', day: null, period: null, hour: 20, minute: 0 } as const;

  it('accepts 70 emoji (140 UTF-16 code units)', () => {
    expect(emoji140).toHaveLength(REMINDER_TEXT_MAX);
    expect(parseReminder(`8pm ${emoji140}`)).toEqual({ ok: true, expr: at8pm, text: emoji140 });
  });

  it('accepts 140 Urdu letters (140 UTF-16 code units)', () => {
    expect(urdu140).toHaveLength(REMINDER_TEXT_MAX);
    expect(parseReminder(`8pm ${urdu140}`)).toEqual({ ok: true, expr: at8pm, text: urdu140 });
  });

  it('gives text-too-long for 70 emoji plus 1 letter (141 UTF-16 code units)', () => {
    expect(parseReminder(`8pm ${emoji140}a`)).toEqual({ ok: false, error: 'text-too-long' });
  });

  it('gives text-too-long for 71 emoji (71 code points, 142 UTF-16 code units)', () => {
    expect(parseReminder(`8pm ${emoji140}😀`)).toEqual({ ok: false, error: 'text-too-long' });
  });
});

describe('parseReminder: Requirement 14.3 arguments', () => {
  it.each([
    ['8pm take medicine', { kind: 'clock', day: null, period: null, hour: 20, minute: 0 }, 'take medicine'],
    ['20:00 call Ali', { kind: 'clock', day: null, period: null, hour: 20, minute: 0 }, 'call Ali'],
    ['kal subah 9 dawai', { kind: 'clock', day: 'tomorrow', period: 'morning', hour: 9, minute: 0 }, 'dawai'],
    ['in 2 hours drink water', { kind: 'relative', amount: 2, unit: 'hour' }, 'drink water'],
    ['شام کو دوا لینی ہے', { kind: 'period', day: null, period: 'evening' }, 'دوا لینی ہے'],
  ])('`%s` parses', (argument, expr, text) => {
    expect(parseReminder(argument)).toEqual({ ok: true, expr, text });
  });
});
