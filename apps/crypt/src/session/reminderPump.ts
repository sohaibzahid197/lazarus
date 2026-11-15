// Reminder pump helpers (design C7, C8; Requirements 13.2, 13.3, 13.8).
// Pure: no timers, clock or browser API. The caller passes both clocks:
// `correctedNow` = browser clock + clockOffset (compared with Due_Times) and
// `browserNow` = browser clock (compared with retryAt and recheckAt).
import type { SnapshotReminder } from '../protocol/snapshot.types';
import type { SessionState } from './session.types';

/** Largest delay `setTimeout` accepts (about 24.8 days); the pump re-arms on wake-up. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

function byDueThenId(a: SnapshotReminder, b: SnapshotReminder): number {
  if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Milliseconds until a Reminder may be checked: 0 or less means it may be checked now. */
function waitFor(
  s: SessionState,
  r: SnapshotReminder,
  correctedNow: number,
  browserNow: number,
): number {
  const retry = s.retryAt.get(r.id);
  const recheck = s.recheckAt.get(r.id);
  return Math.max(
    r.dueAt - correctedNow,
    retry === undefined ? -Infinity : retry - browserNow,
    recheck === undefined ? -Infinity : recheck - browserNow,
  );
}

/**
 * Reminder_Ids that are due on the corrected clock and have no retry or recheck
 * time in the future, sorted by Due_Time and then Reminder_Id.
 */
export function dueReminders(
  s: SessionState,
  correctedNow: number,
  browserNow: number,
): readonly string[] {
  return s.snapshot.reminders
    .filter((r) => waitFor(s, r, correctedNow, browserNow) <= 0)
    .slice()
    .sort(byDueThenId)
    .map((r) => r.id);
}

/**
 * Smallest positive wait until the next Reminder becomes due, as a whole number
 * of milliseconds capped at MAX_TIMER_DELAY_MS; null when no Reminder is waiting.
 * Reminders already due are left to the request effect, which runs after every
 * state change.
 */
export function nextWakeDelay(
  s: SessionState,
  correctedNow: number,
  browserNow: number,
): number | null {
  let best: number | null = null;
  for (const r of s.snapshot.reminders) {
    const wait = waitFor(s, r, correctedNow, browserNow);
    if (wait > 0 && (best === null || wait < best)) best = wait;
  }
  return best === null ? null : Math.min(Math.ceil(best), MAX_TIMER_DELAY_MS);
}
