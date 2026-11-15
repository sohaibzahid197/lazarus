// Example tests for routing, parsing and resolving together:
// routeCommand(body) → argument → parseReminder → resolveDueTime(expr, receivedAt).
// Every time is an explicit millisecond value; nothing reads the real clock.
// _Requirements: 3.1, 3.3, 3.4, 3.7, 14.3, 14.4, 14.5_
import { describe, it, expect } from 'vitest';
import { routeCommand } from './router.js';
import { parseReminder } from './reminder.parse.js';
import { resolveDueTime } from './reminder.resolve.js';
import {
  PK_OFFSET_MS,
  REMINDER_HORIZON_MS,
  type ParseResult,
  type ResolveResult,
} from './reminder.types.js';

/** Epoch ms of a Pakistan_Time wall-clock moment (month is 1-based). */
function pk(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0) - PK_OFFSET_MS;
}

/** 2025-01-15 10:00:00 Pakistan_Time (2025-01-15T05:00:00Z). */
const RECEIVED_AT = Date.UTC(2025, 0, 15, 5, 0, 0, 0);

interface PipelineResult {
  readonly parsed: ParseResult;
  readonly resolved: ResolveResult | null;
}

/** Route the SMS body, parse the REMIND argument and resolve the Due_Time. */
function runPipeline(body: string, receivedAt: number): PipelineResult {
  const routed = routeCommand(body);
  expect(routed.command).toBe('REMIND');
  const parsed = parseReminder(routed.argument);
  return { parsed, resolved: parsed.ok ? resolveDueTime(parsed.expr, receivedAt) : null };
}

interface ResolveCase {
  readonly body: string;
  readonly receivedAt: number;
  readonly expected: ResolveResult;
  readonly text?: string;
}

const RESOLVE_CASES: readonly ResolveCase[] = [
  // 14.3
  { body: 'REMIND 8pm take medicine', receivedAt: RECEIVED_AT, expected: { ok: true, dueAt: pk(2025, 1, 15, 20) }, text: 'take medicine' },
  { body: 'REMIND 20:00 call Ali', receivedAt: RECEIVED_AT, expected: { ok: true, dueAt: pk(2025, 1, 15, 20) }, text: 'call Ali' },
  { body: 'YAAD kal subah 9 dawai', receivedAt: RECEIVED_AT, expected: { ok: true, dueAt: pk(2025, 1, 16, 9) }, text: 'dawai' },
  { body: 'REMIND in 2 hours drink water', receivedAt: RECEIVED_AT, expected: { ok: true, dueAt: RECEIVED_AT + 7_200_000 }, text: 'drink water' },
  { body: 'یاد شام کو دوا لینی ہے', receivedAt: RECEIVED_AT, expected: { ok: true, dueAt: pk(2025, 1, 15, 18) }, text: 'دوا لینی ہے' },
  { body: 'REMIND today 8am x', receivedAt: RECEIVED_AT, expected: { ok: false, error: 'past' } },
  { body: 'REMIND in 31 days x', receivedAt: RECEIVED_AT, expected: { ok: false, error: 'too-far' } },
  // 14.4 horizon boundary (3.7)
  { body: 'REMIND in 30 days x', receivedAt: RECEIVED_AT, expected: { ok: true, dueAt: RECEIVED_AT + REMINDER_HORIZON_MS } },
  { body: 'REMIND in 43201 minutes x', receivedAt: RECEIVED_AT, expected: { ok: false, error: 'too-far' } },
  // 14.5 day boundaries (3.2, 3.3)
  { body: 'REMIND tomorrow 8am x', receivedAt: Date.UTC(2025, 0, 15, 18, 30, 0, 0), expected: { ok: true, dueAt: pk(2025, 1, 16, 8) } },
  { body: 'REMIND 8pm x', receivedAt: pk(2025, 1, 15, 20), expected: { ok: true, dueAt: pk(2025, 1, 16, 20) } },
  // 3.1 example: 8pm received at 20:30 Pakistan_Time moves to the next day.
  { body: 'REMIND 8pm x', receivedAt: Date.UTC(2025, 0, 1, 15, 30, 0, 0), expected: { ok: true, dueAt: Date.UTC(2025, 0, 2, 15, 0, 0, 0) } },
];

describe('REMIND pipeline: route, parse and resolve (3.1, 3.3, 3.4, 3.7, 14.3–14.5)', () => {
  it.each(RESOLVE_CASES)('`$body` at $receivedAt', ({ body, receivedAt, expected, text }) => {
    const { parsed, resolved } = runPipeline(body, receivedAt);
    expect(parsed.ok).toBe(true);
    if (text !== undefined && parsed.ok) expect(parsed.text).toBe(text);
    expect(resolved).toEqual(expected);
  });
});

describe('REMIND pipeline: helper sanity', () => {
  it('pk() matches the 3.1 example instant', () => {
    expect(pk(2025, 1, 2, 20)).toBe(Date.UTC(2025, 0, 2, 15, 0, 0, 0));
    expect(Date.UTC(2025, 0, 2, 15, 0, 0, 0)).toBe(1_735_830_000_000);
  });

  it('the horizon is 30 days and 43201 minutes is 1 minute past it', () => {
    expect(REMINDER_HORIZON_MS).toBe(30 * 86_400_000);
    expect(43_201 * 60_000 - REMINDER_HORIZON_MS).toBe(60_000);
  });
});
