import { localDayKey, zeroCounters } from '@lazarus/brain';
import type { SessionSnapshot } from './snapshot.types';

/** Pakistan_Time offset east of UTC, in minutes, used for every day key. */
export const PK_OFFSET_MINUTES = 300;

/** The Session_Snapshot of a new Simulator_Session (Requirement 8.5, 19.2a). */
export function emptySnapshot(nowMs: number): SessionSnapshot {
  return {
    stopped: false,
    receiveTimes: [],
    slowDownAt: null,
    counters: zeroCounters(localDayKey(nowMs, PK_OFFSET_MINUTES)),
    reminders: [],
  };
}
