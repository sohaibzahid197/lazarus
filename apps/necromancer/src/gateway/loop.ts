// Gateway loop for the `LazarusGateway` headless task (necromancer-sms-gateway design,
// "JS glue" loop outline and "Inbound message flow").
//
// Order at start: load state until the Stop_List is readable (3.7, 3.11, 15.2, 15.8)
// → read the key → apply Pending_Stop_Records (9.15) → `attachLoop` → drain.
// Order per message: take → pipeline → commit (awaited, 3.6) → `completeInbound` (14.7)
// → `cancelPendingSends` after `stopped` (3.9) → hand parts over without awaiting the
// send (6.12) → finalize, counters, activity and notification (8.10, 9.2, 14.1).
// Messages are taken one at a time in the native (receivedAt, seq) order (1.6, 1.7).
//
// The loop never ends on its own (the headless task has no timeout); `stop()` exists
// for tests. A second `startGatewayLoop` call returns the running instance.
import { applyChanges, runGatewayPipeline, type InboundMessage } from '@lazarus/brain';
import type { GatewayPorts, LogFn, Unsubscribe } from '../native/ports';
import { createAiHolder, type AiHolder } from './ai';
import { createCommitQueue } from './commitQueue';
import { applyPendingStops } from './pendingStops';
import { settingsSync as defaultSettingsSync, type SettingsSync, type SettingsUpdate } from './settingsSync';
import { gatewayStore, type GatewayStore } from './store';
import {
  TAKE_RETRY_MS,
  applySettingsUpdate,
  cancelAfterStop,
  handOver,
  loadStateUntilReadable,
  refreshNotification,
  showKeyBanner,
  showLoaded,
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
  const decision = await runGatewayPipeline(
    msg,
    ctx.state,
    { paused: false, today },
    { answer: ctx.ai.answerDeps() },
  );
  ctx.state = applyChanges(ctx.state, decision.changes); // kept even if the write fails (3.12)
  try {
    await ctx.commits.enqueue(decision.changes);
  } catch {
    ctx.log('loop: commit failed, change kept in memory');
  }
  try {
    await ctx.ports.gateway.completeInbound(msg.id);
  } catch {
    ctx.log('loop: completeInbound failed');
  }
  await cancelAfterStop(ctx, decision);
  void handOver(ctx, decision, today);
}

async function takeNext(ctx: LoopContext, race: StopRace): Promise<InboundMessage | null> {
  try {
    const msg = await ctx.ports.gateway.takeNextInbound();
    if (msg === null) await race(ctx.ports.gateway.waitForInbound());
    return msg;
  } catch {
    ctx.log('loop: takeNextInbound failed');
    await race(ctx.clock.sleep(TAKE_RETRY_MS));
    return null;
  }
}

async function drain(ctx: LoopContext, signal: ReturnType<typeof createStopSignal>): Promise<void> {
  while (!signal.isStopped()) {
    const msg = await takeNext(ctx, signal.race);
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
  const ctx: LoopContext = { ports, clock, log, ui, commits, ai, state: loaded.state };
  showLoaded(ctx, loaded, todayKey(clock));
  showKeyBanner(ctx);
  const applied = await applyPendingStops(ports, ctx.state, { commits, log });
  ctx.state = applied.state;
  for (const entry of applied.entries) ui.addActivity(entry);
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
  const offOthers = subscribe(ctx);
  const unsubscribe = (): void => {
    offSettings();
    offOthers();
  };
  ports.gateway.attachLoop();
  refreshNotification(ctx);
  try {
    await drain(ctx, signal);
  } finally {
    unsubscribe();
    await ctx.commits.idle();
  }
}

/** Starts the loop once per process; later calls return the running instance (9.1). */
export function startGatewayLoop(
  ports: GatewayPorts,
  clock: Clock = systemClock,
  options: GatewayLoopOptions = {},
): GatewayLoop {
  if (running !== null) return running;
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
