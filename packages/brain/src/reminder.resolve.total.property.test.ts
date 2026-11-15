// Property test: the Due_Time_Resolver is total and deterministic.
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { resolveDueTime } from './reminder.resolve.js';
import type { ResolveResult } from './reminder.types.js';
import { REMINDER_PBT_OPTIONS, receiveTime, timeExpression } from './reminder.arbitraries.js';

/** True when `r` has exactly one of the two allowed result shapes. */
function isValidResult(r: ResolveResult): boolean {
  if (r.ok) {
    return Object.keys(r).length === 2 && Number.isSafeInteger(r.dueAt);
  }
  return Object.keys(r).length === 2 && (r.error === 'past' || r.error === 'too-far');
}

describe('resolveDueTime totality and determinism', () => {
  // Feature: sms-reminders, Property 13: Due_Time_Resolver never throws and is deterministic
  // **Validates: Requirements 3.9, 3.10**
  it('3.9 resolver returns a Due_Time, past or too-far and never throws', () => {
    fc.assert(
      fc.property(timeExpression, receiveTime, (expr, t) => {
        let result: ResolveResult | undefined;
        expect(() => {
          result = resolveDueTime(expr, t);
        }).not.toThrow();
        expect(result).toBeDefined();
        expect(isValidResult(result as ResolveResult)).toBe(true);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });

  // Feature: sms-reminders, Property 13: Due_Time_Resolver never throws and is deterministic
  // **Validates: Requirements 3.9, 3.10**
  it('3.10 resolver returns an equal result on a second call', () => {
    fc.assert(
      fc.property(timeExpression, receiveTime, timeExpression, receiveTime, (expr, t, otherExpr, otherT) => {
        const first = resolveDueTime(expr, t);
        resolveDueTime(otherExpr, otherT);
        const second = resolveDueTime(expr, t);
        expect(second).toEqual(first);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
