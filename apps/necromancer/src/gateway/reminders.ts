// Reminders runner (sms-reminders design, "JS glue", `runDueReminders` outline and
// "Due reminder flow"). Every decision comes from `@lazarus/brain` (11.12): this module
// only orders the writes, the hand-off to the Sms_Sender and the alarm calls.
//
// Exactly-once (10.8, 10.15, 11.14): the `reminder-handed` marker and the counters
// reserve are committed before `sendParts`; if that commit fails nothing is sent and
// the reminder stays due. A handed reminder is never decided again (`dueReminders`
// skips it, and `reconcileOnLoad` records `reminder-failed` for it after a restart).
//
// Privacy (13.2, 13.3): log lines are fixed strings or hold a Masked_Number. No log
// line, banner or error holds a Reminder_Text, a delivery text or a full number.
import {
  applyChanges,
  buildDeliveryEntry,
  buildProcessingFailedEntry,
  countersFor,
  decideDelivery,
  dueReminders,
  finalizeDelivery,
  maskNumber,
  reconcileOnLoad,
  releaseParts,
  type ActivityEntry,
  type DeliveryOutcome,
  type GatewayState,
  type Reminder,
  type SendReport,
  type StateChange,
} from '@lazarus/brain';
import {
  failedReport,
  refreshNotification,
  showCounters,
  showReminderStatus,
  todayKey,
  type LoopContext,
} from './loopSupport';

/** Requirement 10.14: retry a failed reminder removal 3 times at 1-second intervals. */
export const REMINDER_SAVE_RETRIES = 3;
export const REMINDER_SAVE_RETRY_MS = 1000;

/** Send id of a Reminder_Delivery_Text, distinct from Inbound_Message ids. */
export function reminderSendId(r: Pick<Reminder, 'id'>): string {
  return `reminder:${r.id}`;
}

// ---------------------------------------------------------------- writes

/**
 * Commits `changes` inside the commit chain, retrying 3 times at 1 s without letting
 * another write slip in between (a later counters snapshot must not be overwritten
 * by an older one). Resolves false when every attempt failed.
 */
async function commitWithRetries(ctx: LoopContext, changes: readonly StateChange[]): Promise<boolean> {
  const write = async (): Promise<void> => {
    for (let retry = 0; ; retry++) {
      try {
        await ctx.ports.store.commit(changes);
        return;
      } catch (error: unknown) {
        if (retry >= REMINDER_SAVE_RETRIES) throw error;
        ctx.log(`reminders: save failed, retry ${retry + 1} of ${REMINDER_SAVE_RETRIES}`);
        await ctx.clock.sleep(REMINDER_SAVE_RETRY_MS);
      }
    }
  };
  try {
    await ctx.commits.run(write, { stopList: false, label: 'reminders' });
    return true;
  } catch {
    ctx.log(`reminders: save failed after ${REMINDER_SAVE_RETRIES} retries`);
    ctx.ui.setBanner('reminders-save-failed', true);
    return false;
  }
}

/** Shows the entry and appends it in the commit chain; a failure changes nothing else (13.8). */
async function appendEntry(ctx: LoopContext, entry: ActivityEntry): Promise<void> {
  ctx.ui.addActivity(entry);
  try {
    await ctx.commits.appendActivity(entry);
  } catch {
    const suffix = entry.who === '' ? '' : ` for ${entry.who}`; // `who` is masked or empty
    ctx.log(`reminders: activity append failed${suffix}`);
  }
}

function showAfterChange(ctx: LoopContext): void {
  showReminderStatus(ctx);
  showCounters(ctx, countersFor(ctx.state.counters, todayKey(ctx.clock)));
  refreshNotification(ctx);
}

/**
 * Records one Delivery_Outcome (10.8, 10.14, 13.1, 13.8): the changes (always holding
 * `reminder-remove`) go to memory first, so the reminder is never decided or sent
 * again; then the commit with retries; then exactly one Activity_Entry.
 */
export async function recordDelivery(
  ctx: LoopContext,
  r: Reminder,
  outcome: DeliveryOutcome,
  changes: readonly StateChange[],
  recordedAt: number,
): Promise<void> {
  ctx.state = applyChanges(ctx.state, changes);
  showAfterChange(ctx);
  await commitWithRetries(ctx, changes);
  await appendEntry(ctx, buildDeliveryEntry(r, outcome, recordedAt));
}

// ---------------------------------------------------------------- send

function reportFor(ctx: LoopContext, r: Reminder, parts: readonly string[]): Promise<SendReport> {
  if (ctx.state.stopList.has(r.number)) {
    return Promise.resolve({ status: 'refused-stopped' }); // STOP wins (8.4, 8.7)
  }
  return ctx.ports.gateway.sendParts(reminderSendId(r), r.number, parts).catch((): SendReport => {
    ctx.log(`reminders: send failed for ${maskNumber(r.number)}`);
    return failedReport(parts.length);
  });
}

/**
 * Hands the parts to the existing Sms_Sender (11.11), unless the number is on the
 * in-memory Stop_List right now. A rejected send counts as every part `failed-other`.
 * `today` is the day the parts were reserved on. Never rejects.
 */
export async function sendReminder(
  ctx: LoopContext,
  r: Reminder,
  parts: readonly string[],
  today: string,
): Promise<void> {
  try {
    const report = await reportFor(ctx, r, parts);
    const final = finalizeDelivery(r, parts.length, report, ctx.state.counters, today);
    await recordDelivery(ctx, r, final.outcome, final.changes, ctx.clock.now());
  } catch {
    ctx.log('reminders: delivery finalization failed');
  }
}

/** Undoes the in-memory hand-off of a reminder whose marker commit failed. */
function undoHandOff(state: GatewayState, r: Reminder, partCount: number, today: string): GatewayState {
  const reminders =
    state.reminders.status === 'ok'
      ? {
          status: 'ok' as const,
          reminders: state.reminders.reminders.map((x) => (x.id === r.id ? { ...x, handedAt: null } : x)),
        }
      : state.reminders;
  return { ...state, reminders, counters: releaseParts(state.counters, today, partCount) };
}

/**
 * Applies the hand-off marker and reserve in memory (so concurrent send reports keep
 * the reservation), then commits them. Resolves false, with memory restored, when the
 * commit failed: then nothing may be sent.
 */
async function commitHandOff(
  ctx: LoopContext,
  r: Reminder,
  step: { readonly parts: readonly string[]; readonly changes: readonly StateChange[] },
  today: string,
): Promise<boolean> {
  ctx.state = applyChanges(ctx.state, step.changes);
  try {
    await ctx.commits.enqueue(step.changes);
    return true;
  } catch {
    ctx.log('reminders: hand-off marker not saved, will retry');
    ctx.state = undoHandOff(ctx.state, r, step.parts.length, today);
    return false;
  }
}

/** The current, not yet handed, due copy of `r`; null if it was removed or handed meanwhile. */
function stillDue(ctx: LoopContext, r: Reminder, now: number): Reminder | null {
  return dueReminders(ctx.state.reminders, now).find((x) => x.id === r.id) ?? null;
}

/**
 * Decides one due reminder. Resolves false when the hand-off marker could not be saved,
 * so the run stops and the reminder stays due for the next run.
 */
async function deliverOne(ctx: LoopContext, due: Reminder): Promise<boolean> {
  const now = ctx.clock.now();
  const r = stillDue(ctx, due, now);
  if (r === null) return true;
  const today = todayKey(ctx.clock, now);
  const step = decideDelivery(r, ctx.state, now, today);
  if (step.kind === 'wait') return true;
  if (step.kind === 'final') {
    await recordDelivery(ctx, r, step.outcome, step.changes, now);
    return true;
  }
  if (!(await commitHandOff(ctx, r, step, today))) return false;
  showAfterChange(ctx);
  void sendReminder(ctx, r, step.parts, today); // not awaited, like replies (6.12)
  return true;
}

// ---------------------------------------------------------------- alarms and failures

/** Re-arms the single reminder alarm; a failure is logged and never stops the loop (11.3, 11.4). */
export async function rescheduleSafely(ctx: Pick<LoopContext, 'ports' | 'log'>): Promise<void> {
  try {
    await ctx.ports.reminders.reschedule();
  } catch {
    ctx.log('reminders: reschedule failed');
  }
}

/** Arms the alarm 60 s from now (11.15). */
export async function scheduleRetry(ctx: Pick<LoopContext, 'ports' | 'log'>): Promise<void> {
  try {
    await ctx.ports.reminders.scheduleRetry();
  } catch {
    ctx.log('reminders: retry alarm failed');
  }
}

/** The one "reminder processing failed" Activity_Entry of 11.15; it holds no number. */
export async function recordProcessingFailed(ctx: LoopContext): Promise<void> {
  await appendEntry(ctx, buildProcessingFailedEntry(ctx.clock.now()));
}

// ---------------------------------------------------------------- entry points

/**
 * Load-time cleanup (8.8, 10.15), run before any alarm is armed: removes reminders of
 * Stop_List numbers and records `reminder-failed` for reminders handed before a restart,
 * which are never sent again. Memory first, then the commit with retries, then entries.
 */
export async function reconcileReminders(ctx: LoopContext): Promise<void> {
  const { changes, entries } = reconcileOnLoad(ctx.state, ctx.clock.now());
  if (changes.length > 0) {
    ctx.state = applyChanges(ctx.state, changes);
    await commitWithRetries(ctx, changes);
  }
  for (const entry of entries) await appendEntry(ctx, entry);
  showReminderStatus(ctx);
}

/**
 * One reminders work item (10.11, 11.4, 11.14, 11.15). Due reminders are decided one at
 * a time in (dueAt, id) order, each against the state left by the one before. Ends with
 * `reschedule()`; when the Reminder_Store is unreadable it sends nothing, records one
 * processing-failed entry and arms the 60-second retry instead.
 */
export async function runDueReminders(ctx: LoopContext): Promise<void> {
  ctx.remindersDue = false;
  if (ctx.state.reminders.status === 'unreadable') {
    ctx.log('reminders: store unreadable, retry in 60 s');
    showReminderStatus(ctx);
    await recordProcessingFailed(ctx);
    await scheduleRetry(ctx);
    return;
  }
  for (const r of dueReminders(ctx.state.reminders, ctx.clock.now())) {
    if (!(await deliverOne(ctx, r))) {
      ctx.remindersDue = true; // reminder untouched, nothing sent; the next run retries it
      break;
    }
  }
  await rescheduleSafely(ctx);
  showReminderStatus(ctx);
}
