// Session_Snapshot: the browser-held part of the Gateway_State (Requirement 8.1).
// It holds no phone number; the server adds the Simulator_Number when it parses.
import type { Language } from '@lazarus/brain';

export interface SnapshotReminder {
  readonly id: string; // Reminder_Id, 1..64 chars
  readonly slot: 1 | 2 | 3 | 4 | 5;
  readonly dueAt: number;
  readonly text: string; // 1..140 UTF-16 code units
  readonly language: Language;
  readonly createdAt: number;
}

export interface SnapshotCounters {
  readonly dayKey: string; // localDayKey(…, 300)
  readonly received: number;
  readonly repliesSent: number;
  readonly replied: number;
  readonly partsSent: number;
  readonly ignored: number;
  readonly handed: number;
}

export interface SessionSnapshot {
  readonly stopped: boolean;
  readonly receiveTimes: readonly number[]; // 0..120, non-decreasing
  readonly slowDownAt: number | null;
  readonly counters: SnapshotCounters;
  readonly reminders: readonly SnapshotReminder[]; // 0..5
}
