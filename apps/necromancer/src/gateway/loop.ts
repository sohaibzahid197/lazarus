// Gateway loop for the `LazarusGateway` headless task (necromancer-sms-gateway design,
// "JS glue" loop outline and "Inbound message flow").
//
// Order at start: load state until the Stop_List is readable (3.7, 3.11, 15.2, 15.8)
// → read the key → apply Pending_Stop_Records (9.15) → reconcile reminders (8.8, 10.15)
// → subscribe → `attachLoop` → drain, whose first step runs the due reminders (11.6).
// Before each take the loop runs the due reminders when `remindersDue` is set and the
// gateway is not paused; the idle wait also ends on `onRemindersDue` (sms-reminders
// design, "Gateway loop work order"; 11.7, 11.14, 12.5).
// Order per message: take → pipeline → commit (awaited, 3.6) → `completeInbound` (14.7)
// → `cancelPendingSends` after `stopped` (3.9) → hand parts over without awaiting the
// send (6.12) → finalize, counters, activity and notification (8.10, 9.2, 14.1).
// Messages are taken one at a time in the native (receivedAt, seq) order (1.6, 1.7).
//
// The loop never ends on its own (the headless task has no timeout); `stop()` exists
// for tests. A second `startGatewayLoop` call returns the running instance.
import { runGatewayPipeline, type InboundMessage } from '@lazarus/brain';
import type { GatewayPorts, LogFn, Unsubscribe } from '../native/ports';
import { createAiHolder, type AiHolder } from './ai';
import { createCommitQueue } from './commitQueue';
import {
  afterReminderChange,
  commitDecision,
  createReminderControl,
  markRemindersDue,
  runRemindersIfDue,
  subscribeReminders,
  type ReminderControl,
} from './loopReminders';
import { applyPendingStops } from './pendingStops';
import { reconcileReminders } from './reminders';
import { settingsSync as defaultSettingsSync, type SettingsSync, type SettingsUpdate } from './settingsSync';
import { gatewayStore, type GatewayStore } from './store';
import {
  TAKE_RETRY_MS,
  applySettingsUpdate,
  cancelAfterStop,
  handOver,
  loadStateUntilReadable,
  refreshNotification,
  showExactAlarmStatus,
  showKeyBanner,
  showLoaded,
  showReminderStatus,
  systemClock,
  todayKey,
  type Clock,
  type LoopContext,
  type StopRace,
} from './loopSupport';

export { systemClock, type Clock } from './loopSupport';

export interface GatewayLoopOptions {
  /** Shared with the Settings_Screen so a key save rebuilds the client the loop uses. */
  readonly ai?: AiHolder;
  readonly ui?: GatewayStore;
  readonly log?: LogFn;
  /** Channel the Settings_Screen publishes saved changes on; defaults to the app-wide one. */
  readonly settingsSync?: SettingsSync;
}

export interface GatewayLoop {
  /** Settles when the loop has exited (only after `stop()`). */
  readonly finished: Promise<void>;
  /** Ends the loop after the current message and waits for queued writes. */
  stop(): Promise<void>;
}

const defaultLog: LogFn = (line) => console.warn(line);

let running: GatewayLoop | null = null;
/** Marks reminders due on the running loop; set once its context is ready. */
let nudgeRunning: (() => void) | null = null;

function createStopSignal(): { stop: () => void; isStopped: () => boolean; race: StopRace } {
  let stopped = false;
  let fire: () => void = () => undefined;
  const signal = new Promise<true>((resolve) => {
    fire = () => resolve(true);
  });
  return {
    stop: () => {
      stopped = true;
      fire();
    },
    isStopped: () => stopped,
    race: (work) => Promise.race([work.then(() => stopped), signal]),
  };
}

async function processMessage(ctx: LoopContext, msg: InboundMessage): Promise<void> {
  ctx.ui.pulseInbound();
  const today = todayKey(ctx.clock, msg.receivedAt);
  const decided = await runGatewayPipeline(
    msg,
    ctx.state,
    { paused: false, today },
    { answer: ctx.ai.answerDeps() },
  );
  const decision = await commitDecision(ctx, decided); // 3.6, 3.12, 12.11
  try {
    await ctx.ports.gateway.completeInbound(msg.id);
  } catch {
    ctx.log('loop: completeInbound failed');
  }
  await cancelAfterStop(ctx, decision);
  void handOver(ctx, decision, today);
  await afterReminderChange(ctx, decision.changes); // alarm follows the earliest Due_Time (11.3)
}

/**
 * One outstanding `waitForInbound()` at a time: a wait that lost the race against
 * `onRemindersDue` is reused by the next idle wait instead of being left behind.
 */
function sharedInboundWait(ctx: LoopContext): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    if (pending === null) {
      const wait = ctx.ports.gateway.waitForInbound();
      pending = wait;
      const clear = (): void => {
        if (pending === wait) pending = null;
      };
      wait.then(clear, clear);
    }
    return pending;
  };
}
async function takeNext(
  ctx: LoopContext,
  race: StopRace,
  idleWait: () => Promise<void>,
): Promise<InboundMessage | null> {
  try {
    const msg = await ctx.ports.gateway.takeNextInbound();
    if (msg === null) await race(idleWait());
    return msg;
  } catch {
    ctx.log('loop: takeNextInbound failed');
    await race(ctx.clock.sleep(TAKE_RETRY_MS));
    return null;
  }
}

async function drain(
  ctx: LoopContext,
  control: ReminderControl,
  signal: ReturnType<typeof createStopSignal>,
): Promise<void> {
  const inboundWait = sharedInboundWait(ctx);
  const idleWait = async (): Promise<void> => {
    const wake = control.wake.wait();
    try {
      await Promise.race([inboundWait(), wake.promise]);
    } finally {
      wake.cancel();
    }
  };
  while (!signal.isStopped()) {
    await runRemindersIfDue(ctx, control); // between messages, never during one (12.5)
    if (signal.isStopped()) break;
    const msg = await takeNext(ctx, signal.race, idleWait);
    if (msg !== null) await processMessage(ctx, msg);
  }
}

async function prepare(
  ports: GatewayPorts,
  clock: Clock,
  options: GatewayLoopOptions,
  signal: ReturnType<typeof createStopSignal>,
): Promise<LoopContext | null> {
  const ui = options.ui ?? gatewayStore;
  const log = options.log ?? defaultLog;
  const loaded = await loadStateUntilReadable(ports, clock, ui, log, signal.race);
  if (loaded === null) return null;
  const ai = options.ai ?? createAiHolder(ports.keyStore, () => clock.now(), log);
  await ai.refresh();
  const commits = createCommitQueue({
    store: ports.store,
    onStopListSaveFailed: () => ui.setBanner('stop-list-save-failed', true),
    sleep: (ms) => clock.sleep(ms),
    log,
  });
  const ctx: LoopContext = {
    ports,
    clock,
    log,
    ui,
    commits,
    ai,
    state: loaded.state,
    remindersDue: true, // loop start (sms-reminders 11.6)
  };
  showLoaded(ctx, loaded, todayKey(clock));
  showReminderStatus(ctx);
  showKeyBanner(ctx);
  await showExactAlarmStatus(ports.reminders, ui, log); // 11.9
  const applied = await applyPendingStops(ports, ctx.state, { commits, log });
  ctx.state = applied.state;
  for (const entry of applied.entries) ui.addActivity(entry);
  await reconcileReminders(ctx); // after the Stop_List is known, before any alarm (8.8)
  return ctx;
}

function subscribe(ctx: LoopContext): Unsubscribe {
  const offKey = ctx.ai.subscribe(() => showKeyBanner(ctx));
  const offSend = ctx.ports.gateway.onSendState((sending) => {
    ctx.ui.setSending(sending);
    refreshNotification(ctx);
  });
  return () => {
    offKey();
    offSend();
  };
}

async function run(
  ports: GatewayPorts,
  clock: Clock,
  options: GatewayLoopOptions,
  signal: ReturnType<typeof createStopSignal>,
): Promise<void> {
  // Subscribe before loading, so a Settings_Screen save made while the loop is
  // still starting is not lost. Early updates are replayed onto the loaded state;
  // replaying a change the load already read is harmless (replace and set add).
  const early: SettingsUpdate[] = [];
  let live: LoopContext | null = null;
  const offSettings = (options.settingsSync ?? defaultSettingsSync).subscribe((update) => {
    if (live === null) early.push(update);
    else applySettingsUpdate(live, update);
  });
  const ctx = await prepare(ports, clock, options, signal);
  if (ctx === null || signal.isStopped()) {
    offSettings();
    return;
  }
  live = ctx;
  for (const update of early.splice(0)) applySettingsUpdate(ctx, update);
  const control = createReminderControl();
  const offOthers = subscribe(ctx);
  const offReminders = subscribeReminders(ctx, control);
  nudgeRunning = () => {
    control.paused = false; // the Gateway_Service started again, so it is not paused
    markRemindersDue(ctx, control);
  };
  const unsubscribe = (): void => {
    nudgeRunning = null;
    offSettings();
    offOthers();
    offReminders();
  };
  ports.gateway.attachLoop();
  refreshNotification(ctx);
  try {
    await drain(ctx, control, signal);
  } finally {
    unsubscribe();
    await ctx.commits.idle();
  }
}

/**
 * Starts the loop once per process; later calls return the running instance (9.1).
 * A later call is a Gateway_Service start or resume, so it makes reminders due (11.6).
 */
export function startGatewayLoop(
  ports: GatewayPorts,
  clock: Clock = systemClock,
  options: GatewayLoopOptions = {},
): GatewayLoop {
  if (running !== null) {
    nudgeRunning?.();
    return running;
  }
  const signal = createStopSignal();
  const log = options.log ?? defaultLog;
  const finished = run(ports, clock, options, signal).catch(() => log('loop: stopped by error'));
  const loop: GatewayLoop = {
    finished,
    stop: async () => {
      signal.stop();
      await finished;
    },
  };
  running = loop;
  void finished.then(() => {
    if (running === loop) running = null;
  });
  return loop;
}
