// Unit tests for the Time_Printer: examples and validity boundaries.
// _Requirements: 4.1, 4.4_
import { describe, it, expect } from 'vitest';
import { isValidTimeExpression, printTimeExpression } from './reminder.print.js';
import { parseReminder } from './reminder.parse.js';
import type { TimeExpression } from './reminder.types.js';

describe('printTimeExpression (4.1)', () => {
  it.each<[TimeExpression, string]>([
    [{ kind: 'clock', day: null, period: 'evening', hour: 18, minute: 0 }, 'evening 6:00'],
    [{ kind: 'clock', day: 'tomorrow', period: 'morning', hour: 12, minute: 59 }, 'tomorrow morning 12:59'],
    [{ kind: 'relative', amount: 1, unit: 'hour' }, 'in 1 hour'],
    [{ kind: 'relative', amount: 999_999, unit: 'minute' }, 'in 999999 minutes'],
  ])('prints %o as `%s`', (expr, expected) => {
    expect(printTimeExpression(expr)).toBe(expected);
  });
});

describe('isValidTimeExpression accepts every task 4.6 parse result (4.4)', () => {
  it.each([
    'subah 8pm x',
    'shaam x',
    'shaam ko 6 baje x',
    'at 8pm x',
    '8pm take medicine',
    '20:00 call Ali',
    'kal subah 9 dawai',
    'in 2 hours drink water',
    'شام کو دوا لینی ہے',
  ])('`%s`', (argument) => {
    const result = parseReminder(argument);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isValidTimeExpression(result.expr)).toBe(true);
  });
});

describe('isValidTimeExpression rejects out-of-range values (4.4)', () => {
  it.each<[string, TimeExpression]>([
    ['hour 24', { kind: 'clock', day: null, period: null, hour: 24, minute: 0 }],
    ['minute 60', { kind: 'clock', day: null, period: null, hour: 8, minute: 60 }],
    ['evening with hour 9', { kind: 'clock', day: null, period: 'evening', hour: 9, minute: 0 }],
    ['N 0', { kind: 'relative', amount: 0, unit: 'hour' }],
  ])('%s', (_label, expr) => {
    expect(isValidTimeExpression(expr)).toBe(false);
  });
});
