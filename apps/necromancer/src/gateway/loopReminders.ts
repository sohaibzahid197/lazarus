// Reminders work item of the gateway loop (sms-reminders design, "Gateway loop work
// order"). The loop runs due reminders between Inbound_Messages, never during one, so
// every reminder change is committed before the next message or reminder (12.5, 11.14).
//
// `remindersDue` is set by loop start, `onRemindersDue` (the reminder alarm, including
// the 60-second retry alarm of 11.15), a repeated Gateway_Service start and resume
// (11.6). While the Operator has paused the gateway nothing is decided or sent (11.7);
// the native receiver only re-arms the alarm then.
//
// Privacy: log lines are fixed strings (13.2, 13.3).
import {
  applyChanges,
  reminderWriteFailed,
  splitSms,
  type GatewayDecision,
  type ServiceStatus,
  type StateChange,
} from '@lazarus/brain';
import type { Unsubscribe } from '../native/ports';
import { showReminderStatus, todayKey, type LoopContext } from './loopSupport';
import { reconcileReminders, rescheduleSafely, runDueReminders } from './reminders';

/** Wakes an idle loop when reminders become due. An event before `wait()` is not lost. */
export interface ReminderWake {
  notify(): void;
  /**
   * Resolves on the next `notify`, or at once if one arrived since the last `consume`.
   * `cancel` drops the listener, so idle waits that ended on an Inbound_Message do not
   * pile up.
   */
  wait(): { readonly promise: Promise<void>; cancel(): void };
  consume(): void;
}

export function createReminderWake(): ReminderWake {
  let pending = false;
  const waiters = new Set<() => void>();
  return {
    notify: () => {
      pending = true;
      for (const resolve of [...waiters]) resolve();
      waiters.clear();
    },
    wait: () => {
      if (pending) return { promise: Promise.resolve(), cancel: () => undefined };
      let resolve: () => void = () => undefined;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      waiters.add(resolve);
      return { promise, cancel: () => waiters.delete(resolve) };
    },
    consume: () => {
      pending = false;
    },
  };
}

/** Loop-local reminder control: the wake signal and the paused flag (11.7). */
export interface ReminderControl {
  readonly wake: ReminderWake;
  paused: boolean;
}

export function createReminderControl(): ReminderControl {
  return { wake: createReminderWake(), paused: false };
}

/** Marks reminders due and wakes a waiting loop (11.6). */
export function markRemindersDue(ctx: LoopContext, control: ReminderControl): void {
  ctx.remindersDue = true;
  control.wake.notify();
}

/** Tracks pause and resume from the Gateway_Service status; resume makes reminders due. */
export function onServiceStatusChange(
  ctx: LoopContext,
  control: ReminderControl,
  status: ServiceStatus,
): void {
  if (status === 'paused') {
    control.paused = true;
    return;
  }
  if (status === 'running' && control.paused) {
    control.paused = false;
    markRemindersDue(ctx, control);
  }
}

/** `onRemindersDue` and service-status subscriptions; both end on loop stop. */
export function subscribeReminders(ctx: LoopContext, control: ReminderControl): Unsubscribe {
  const offDue = ctx.ports.reminders.onRemindersDue(() => markRemindersDue(ctx, control));
  const offStatus = ctx.ports.gateway.onServiceStatus((status) =>
    onServiceStatusChange(ctx, control, status),
  );
  return () => {
    offDue();
    offStatus();
  };
}

/**
 * Reads the Reminder_Store again after a failed read (11.4, 11.15). Only the reminders
 * are taken from the load: while the store was unreadable nothing added or removed one.
 */
async function reloadReminders(ctx: LoopContext): Promise<void> {
  try {
    const decoded = await ctx.ports.store.loadState(todayKey(ctx.clock));
    if (decoded.status !== 'ok' || decoded.state.reminders.status !== 'ok') return;
    ctx.state = { ...ctx.state, reminders: decoded.state.reminders };
  } catch {
    ctx.log('reminders: reload failed');
    return;
  }
  await reconcileReminders(ctx); // Stop_List removals and handed rows before any alarm (8.8)
}

/** Runs the due reminders when flagged and not paused. Never rejects. */
export async function runRemindersIfDue(ctx: LoopContext, control: ReminderControl): Promise<void> {
  control.wake.consume(); // an event seen while paused must not keep waking the loop
  if (!ctx.remindersDue || control.paused) return;
  try {
    if (ctx.state.reminders.status === 'unreadable') await reloadReminders(ctx);
    await runDueReminders(ctx);
  } catch {
    ctx.log('reminders: run failed');
  }
}

// ---------------------------------------------------------------- pipeline decisions

const REMINDER_CHANGE_TYPES: ReadonlySet<StateChange['type']> = new Set<StateChange['type']>([
  'reminder-add',
  'reminder-remove',
  'reminder-remove-all',
]);

function hasReminderWrite(changes: readonly StateChange[]): boolean {
  return changes.some((c) => c.type === 'reminder-add' || c.type === 'reminder-remove');
}

/** true when the batch adds or removes a reminder (REMIND, CANCEL, STOP). */
export function changesReminders(changes: readonly StateChange[]): boolean {
  return changes.some((c) => REMINDER_CHANGE_TYPES.has(c.type));
}

async function commitKeepingMemory(ctx: LoopContext, changes: readonly StateChange[]): Promise<void> {
  ctx.state = applyChanges(ctx.state, changes); // kept even if the write fails (3.12, 8.6)
  try {
    await ctx.commits.enqueue(changes);
  } catch {
    ctx.log('loop: commit failed, change kept in memory');
  }
}

/**
 * Commits a pipeline decision and returns the decision to hand over. A batch with
 * `reminder-add` or `reminder-remove` is committed before memory changes; if that
 * commit rejects, the Reminders_Unavailable_Text decision is used and committed instead
 * (12.5, 12.11). Every other batch, STOP included, keeps memory first (8.6).
 */
export async function commitDecision(
  ctx: LoopContext,
  decision: GatewayDecision,
): Promise<GatewayDecision> {
  if (!hasReminderWrite(decision.changes)) {
    await commitKeepingMemory(ctx, decision.changes);
    return decision;
  }
  try {
    await ctx.commits.enqueue(decision.changes);
    ctx.state = applyChanges(ctx.state, decision.changes);
    return decision;
  } catch {
    ctx.log('loop: reminder commit failed, replying reminders unavailable');
    const failed = reminderWriteFailed(decision, splitSms);
    await commitKeepingMemory(ctx, failed.changes);
    return failed;
  }
}

/** Count, banner and alarm after a decision that added or removed reminders (11.3, 8.9). */
export async function afterReminderChange(ctx: LoopContext, changes: readonly StateChange[]): Promise<void> {
  if (!changesReminders(changes)) return;
  showReminderStatus(ctx);
  await rescheduleSafely(ctx);
}
