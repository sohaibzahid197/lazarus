// Helpers for the gateway loop (necromancer-sms-gateway design, "JS glue" and
// "Error handling"). Kept apart from `loop.ts` so each function stays small.
//
// Privacy: log lines name the step and, at most, a Masked_Number or Masked_Sender.
// They never hold a body, a full number or an error message (Requirements 14.6, 14.7).
import {
  applyChanges,
  buildActivityEntry,
  countersFor,
  deriveHeartbeat,
  finalizeSend,
  localDayKey,
  maskNumber,
  type CanonicalNumber,
  type DayCounters,
  type DecodedState,
  type GatewayDecision,
  type GatewayState,
  type SendReport,
} from '@lazarus/brain';
import type { GatewayPorts, LogFn } from '../native/ports';
import type { AiHolder } from './ai';
import type { CommitQueue } from './commitQueue';
import { allowlistOnly, type SettingsUpdate } from './settingsSync';
import type { GatewaySnapshot, GatewayStore } from './store';

/** Time source for the loop; tests pass fakes. */
export interface Clock {
  now(): number;
  /** Local offset east of UTC in minutes at `atMs` (default: now), e.g. 300 for UTC+5. */
  tzOffsetMinutes(atMs?: number): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  tzOffsetMinutes: (atMs) => -new Date(atMs ?? Date.now()).getTimezoneOffset(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Requirement 3.11: retry a failed Stop_List read every 30 s. */
export const LOAD_RETRY_MS = 30_000;
/** Pause after a failed `takeNextInbound`, so a broken port cannot spin the CPU. */
export const TAKE_RETRY_MS = 1_000;

export type LoadedState = Extract<DecodedState, { status: 'ok' }>;

/** Everything one loop run shares. `state` is the in-memory Gateway_State. */
export interface LoopContext {
  readonly ports: GatewayPorts;
  readonly clock: Clock;
  readonly log: LogFn;
  readonly ui: GatewayStore;
  readonly commits: CommitQueue;
  readonly ai: AiHolder;
  state: GatewayState;
}

/** Resolves true when `stopped` fired first. */
export type StopRace = (work: Promise<unknown>) => Promise<boolean>;

export function todayKey(clock: Clock, atMs: number = clock.now()): string {
  return localDayKey(atMs, clock.tzOffsetMinutes(atMs));
}

export function phoneOf(decision: GatewayDecision): CanonicalNumber | null {
  return decision.sender.kind === 'phone' ? decision.sender.number : null;
}

function whoOf(decision: GatewayDecision): string {
  return decision.sender.kind === 'phone'
    ? maskNumber(decision.sender.number)
    : decision.sender.masked;
}

// ---------------------------------------------------------------- notification and banners

/** Heartbeat word for the notification; before the first Device_Status only service and send state count. */
export function heartbeatWord(s: GatewaySnapshot): string {
  if (s.deviceStatus !== null) return deriveHeartbeat(s.deviceStatus, s.serviceStatus, s.sending).state;
  if (s.serviceStatus !== 'running') return 'SLEEPING';
  return s.sending ? 'SENDING' : 'ALIVE';
}

/** Requirement 9.2: Heartbeat word and today's `replied` count, nothing else. */
export function refreshNotification(ctx: LoopContext): void {
  const counters = countersFor(ctx.state.counters, todayKey(ctx.clock));
  ctx.ports.gateway.updateNotification(heartbeatWord(ctx.ui.getSnapshot()), counters.replied);
}

function showCounters(ctx: LoopContext, counters: DayCounters): void {
  ctx.ui.setCounters(counters);
  ctx.ui.setBanner('cap-reached', counters.handed >= ctx.state.settings.dailySendCap);
}

export function showKeyBanner(ctx: LoopContext): void {
  ctx.ui.setBanner('ai-key-missing', ctx.ai.answerDeps() === null);
}

/** Banners and counters that follow from a successful load (Requirements 4.9, 15.5). */
export function showLoaded(ctx: LoopContext, loaded: LoadedState, today: string): void {
  ctx.ui.setBanner('stop-list-unreadable', false);
  ctx.ui.setBanner('settings-reset', loaded.settingsStatus === 'invalid');
  ctx.ui.setBanner('allowlist-unreadable', loaded.state.allowlist === 'unreadable');
  ctx.ui.setServiceStatus('running');
  showCounters(ctx, countersFor(loaded.state.counters, today));
}

/**
 * Applies a saved Settings_Screen change to the in-memory Gateway_State, so the next
 * message uses it without restarting the Gateway_Service (Requirement 15.1, 15.6).
 */
export function applySettingsUpdate(ctx: LoopContext, update: SettingsUpdate): void {
  const changes = allowlistOnly(update.allowlistChanges ?? []);
  const withList = changes.length > 0 ? applyChanges(ctx.state, changes) : ctx.state;
  ctx.state = update.settings === undefined ? withList : { ...withList, settings: update.settings };
  showCounters(ctx, countersFor(ctx.state.counters, todayKey(ctx.clock)));
  refreshNotification(ctx);
}

// ---------------------------------------------------------------- load

async function tryLoad(ports: GatewayPorts, today: string): Promise<LoadedState | null> {
  try {
    const decoded = await ports.store.loadState(today);
    return decoded.status === 'ok' ? decoded : null;
  } catch {
    return null;
  }
}

function showUnreadable(ports: GatewayPorts, ui: GatewayStore, log: LogFn): void {
  log('loop: stop list unreadable, replies held, retry in 30 s');
  ui.setBanner('stop-list-unreadable', true);
  ui.setServiceStatus('stopped'); // Heartbeat SLEEPING service-stopped (3.11, 15.8)
  ports.gateway.updateNotification(heartbeatWord(ui.getSnapshot()), 0);
}

/**
 * Loads the Gateway_State, retrying every 30 s while the Stop_List is unreadable.
 * No message is taken meanwhile, and stored data is never rewritten (3.7, 3.11, 15.2, 15.8).
 * Resolves null only when the loop was stopped.
 */
export async function loadStateUntilReadable(
  ports: GatewayPorts,
  clock: Clock,
  ui: GatewayStore,
  log: LogFn,
  raceStop: StopRace,
): Promise<LoadedState | null> {
  for (;;) {
    const loaded = await tryLoad(ports, todayKey(clock));
    if (loaded !== null) return loaded;
    showUnreadable(ports, ui, log);
    if (await raceStop(clock.sleep(LOAD_RETRY_MS))) return null;
  }
}

// ---------------------------------------------------------------- finalization

/** Writes queued in the commit chain; failures are logged and never stop processing (14.12). */
function persistFinal(
  ctx: LoopContext,
  changes: Parameters<CommitQueue['enqueue']>[0],
  entry: ReturnType<typeof buildActivityEntry>,
): void {
  ctx.commits.enqueue(changes).catch(() => ctx.log('loop: counters commit failed'));
  ctx.commits
    .appendActivity(entry)
    .catch(() => ctx.log(`loop: activity append failed for ${entry.who}`));
}

/**
 * Final_Outcome, counters, Activity_Entry and notification for one message
 * (Requirements 8.10, 9.2, 14.1). Runs synchronously against the current
 * in-memory state, so concurrent send reports never lose a counter update.
 */
export function finalize(
  ctx: LoopContext,
  decision: GatewayDecision,
  report: SendReport | null,
  today: string,
): void {
  const final = finalizeSend(decision, report, ctx.state.counters, today);
  ctx.state = applyChanges(ctx.state, final.changes);
  const entry = buildActivityEntry(decision, final.outcome);
  persistFinal(ctx, final.changes, entry);
  ctx.ui.addActivity(entry);
  showCounters(ctx, countersFor(ctx.state.counters, todayKey(ctx.clock)));
  refreshNotification(ctx);
}

function failedReport(partCount: number): SendReport {
  return { status: 'done', results: Array.from({ length: partCount }, () => 'failed-other'), attempts: 1 };
}

/**
 * Hands the parts to the Sms_Sender without blocking the take loop (6.12, 8.7),
 * unless the number is on the in-memory Stop_List (3.12): then no send, and the
 * message is finalized as `refused-stopped`.
 */
export function handOver(ctx: LoopContext, decision: GatewayDecision, today: string): Promise<void> {
  const number = phoneOf(decision);
  if (decision.parts.length === 0) {
    finalize(ctx, decision, null, today);
    return Promise.resolve();
  }
  if (number === null || ctx.state.stopList.has(number)) {
    finalize(ctx, decision, { status: 'refused-stopped' }, today);
    return Promise.resolve();
  }
  return ctx.ports.gateway
    .sendParts(decision.messageId, number, decision.parts)
    .catch((): SendReport => {
      ctx.log(`loop: send failed for ${whoOf(decision)}`);
      return failedReport(decision.parts.length);
    })
    .then((report) => finalize(ctx, decision, report, today));
}

/** Requirement 3.9: earlier replies to a number that just sent STOP are cancelled natively. */
export async function cancelAfterStop(ctx: LoopContext, decision: GatewayDecision): Promise<void> {
  const number = phoneOf(decision);
  if (decision.outcome !== 'stopped' || number === null) return;
  try {
    await ctx.ports.gateway.cancelPendingSends(number);
  } catch {
    ctx.log(`loop: cancel pending sends failed for ${maskNumber(number)}`);
  }
}
