// Reminder_Store_Model (sms-reminders design, "Reminder_Store_Model").
// Pure queries over ReminderState and the fold of the four reminder StateChanges.
import type {
  ActivityEntry,
  CanonicalNumber,
  GatewayState,
  StateChange,
} from './gateway.types.js';
import { buildDeliveryEntry } from './reminder.delivery.js';
import { REMINDER_LIMIT } from './reminder.types.js';
import type { Reminder, ReminderSlot, ReminderState } from './reminder.types.js';

export type ReminderChange = Extract<
  StateChange,
  { readonly type: 'reminder-add' | 'reminder-remove' | 'reminder-remove-all' | 'reminder-handed' }
>;

const SLOTS: readonly ReminderSlot[] = [1, 2, 3, 4, 5];

const remindersOf = (state: ReminderState): readonly Reminder[] =>
  state.status === 'ok' ? state.reminders : [];

/** Active_Reminders of one number; empty when the store is unreadable. */
export function activeFor(state: ReminderState, number: CanonicalNumber): readonly Reminder[] {
  return remindersOf(state).filter((r) => r.number === number);
}

/** Lowest Reminder_Slot not used by `active`; null when all 5 are used (5.1, 7.6). */
export function lowestFreeSlot(active: readonly Reminder[]): ReminderSlot | null {
  return SLOTS.find((slot) => !active.some((r) => r.slot === slot)) ?? null;
}

export function findBySlot(active: readonly Reminder[], slot: number): Reminder | null {
  return active.find((r) => r.slot === slot) ?? null;
}

const byDueThenId = (a: Reminder, b: Reminder): number =>
  a.dueAt !== b.dueAt ? a.dueAt - b.dueAt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Not handed, dueAt <= now, sorted by (dueAt, id) (10.11, 11.4). */
export function dueReminders(state: ReminderState, now: number): readonly Reminder[] {
  return remindersOf(state)
    .filter((r) => r.handedAt === null && r.dueAt <= now)
    .sort(byDueThenId);
}

/** Earliest dueAt among reminders not handed; null if none (11.1–11.3). */
export function nextDueAt(state: ReminderState): number | null {
  const pending = remindersOf(state).filter((r) => r.handedAt === null);
  return pending.length === 0 ? null : Math.min(...pending.map((r) => r.dueAt));
}

/** Below the Reminder_Limit, slot free and id new, so the fold keeps 5.13 for any change list. */
function canAdd(reminders: readonly Reminder[], reminder: Reminder): boolean {
  const active = reminders.filter((r) => r.number === reminder.number);
  return (
    active.length < REMINDER_LIMIT &&
    findBySlot(active, reminder.slot) === null &&
    !reminders.some((r) => r.id === reminder.id)
  );
}

function applyToList(reminders: readonly Reminder[], change: ReminderChange): readonly Reminder[] {
  switch (change.type) {
    case 'reminder-add':
      return canAdd(reminders, change.reminder) ? [...reminders, change.reminder] : reminders;
    case 'reminder-remove':
      return reminders.filter((r) => r.id !== change.id);
    case 'reminder-remove-all':
      return reminders.filter((r) => r.number !== change.number);
    case 'reminder-handed':
      return reminders.map((r) => (r.id === change.id ? { ...r, handedAt: change.at } : r));
  }
}

/** Pure fold of one reminder change; an unreadable store stays unreadable (12.7). */
export function applyReminderChange(state: ReminderState, change: ReminderChange): ReminderState {
  if (state.status === 'unreadable') return state;
  return { status: 'ok', reminders: applyToList(state.reminders, change) };
}
/** Distinct Stop_List numbers that still have reminders, in first-seen store order (8.8). */
function stoppedNumbers(reminders: readonly Reminder[], state: GatewayState): CanonicalNumber[] {
  const numbers = reminders.map((r) => r.number).filter((n) => state.stopList.has(n));
  return [...new Set(numbers)];
}
/** Handed but not finalized reminders of numbers not on the Stop_List (10.15). */
function orphanedHanded(reminders: readonly Reminder[], state: GatewayState): Reminder[] {
  return reminders.filter((r) => r.handedAt !== null && !state.stopList.has(r.number));
}
/**
 * Load-time cleanup (8.8, 10.15): `reminder-remove-all` for each Stop_List
 * number with reminders; for each handed reminder of any other number,
 * `reminder-remove` and one `reminder-failed` Activity_Entry at `now`.
 * An unreadable store yields nothing.
 */
export function reconcileOnLoad(
  state: GatewayState,
  now: number,
): { readonly changes: readonly StateChange[]; readonly entries: readonly ActivityEntry[] } {
  const reminders = remindersOf(state.reminders);
  const handed = orphanedHanded(reminders, state);
  const changes: StateChange[] = [
    ...stoppedNumbers(reminders, state).map(
      (number): StateChange => ({ type: 'reminder-remove-all', number }),
    ),
    ...handed.map((r): StateChange => ({ type: 'reminder-remove', id: r.id })),
  ];
  const entries = handed.map((r) => buildDeliveryEntry(r, 'reminder-failed', now));
  return { changes, entries };
}
