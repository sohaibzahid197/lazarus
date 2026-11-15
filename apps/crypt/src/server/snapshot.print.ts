import 'server-only';
import type { CanonicalNumber, DayCounters, GatewayState, Reminder } from '@lazarus/brain';
import type { SessionSnapshot, SnapshotCounters, SnapshotReminder } from '../protocol/snapshot.types';

// Snapshot_Printer (Requirements 8.1, 8.2, 8.7): the inverse of `parseSnapshot`.
// It turns the Gateway_State of the Simulator_Session back into a
// Session_Snapshot with no phone number in it.

function printCounters(c: DayCounters): SnapshotCounters {
  return {
    dayKey: c.dayKey,
    received: c.received,
    repliesSent: c.repliesSent,
    replied: c.replied,
    partsSent: c.partsSent,
    ignored: c.ignored,
    handed: c.handed,
  };
}

function printReminder(r: Reminder): SnapshotReminder {
  if (r.handedAt !== null) throw new Error('reminder handed but not finalized');
  return {
    id: r.id,
    slot: r.slot,
    dueAt: r.dueAt,
    text: r.text,
    language: r.language,
    createdAt: r.createdAt,
  };
}

/**
 * Prints the Session_Snapshot of `number` from `state`. Throws on an
 * `unreadable` Reminder_Store or a Reminder with a non-null `handedAt`;
 * neither is reachable in the simulator, and the handler turns a throw into 500.
 */
export function printSnapshot(state: GatewayState, number: CanonicalNumber): SessionSnapshot {
  if (state.reminders.status !== 'ok') throw new Error('reminder store unreadable');
  return {
    stopped: state.stopList.has(number),
    receiveTimes: [...(state.rate.get(number) ?? [])],
    slowDownAt: state.slowDown.get(number) ?? null,
    counters: printCounters(state.counters),
    reminders: state.reminders.reminders.map(printReminder),
  };
}
