// Headless task `LazarusPausedInbox` (necromancer-sms-gateway design, "Paused path flow";
// Requirements 9.10–9.13, 9.15). Kotlin starts one short task per Inbound_Message while
// the Operator has paused the gateway; the body arrives only in the task args (memory).
//
// Steps: load state → apply every Pending_Stop_Record → `runGatewayPipeline` with
// `paused: true` and `answer: null` (no AI_Client) → commit the decision changes and the
// day counters in one batch → append the Activity_Entry → end. A STOP whose commit fails
// after the commit queue's 3 retries becomes a Pending_Stop_Record (`savePendingStop`),
// so it is applied at the next start and never lost. This task never starts or resumes
// the Gateway_Service and stores nothing else for a non-STOP message.
//
// If the state cannot be loaded, the Command_Router still decides STOP on the body in
// memory: a STOP becomes a Pending_Stop_Record (its Activity_Entry is added when it is
// applied), anything else gets one `ignored-paused` Activity_Entry.
//
// Log lines never hold a body, a full number or an error message.
import {
  applyChanges,
  buildActivityEntry,
  finalizeSend,
  localDayKey,
  maskSender,
  routeCommand,
  runGatewayPipeline,
  type ActivityEntry,
  type GatewayDecision,
  type GatewayState,
  type InboundMessage,
  type StateChange,
} from '@lazarus/brain';
import { createLivePorts, type GatewayPorts, type LogFn } from '../native/ports';
import { createCommitQueue, type CommitQueue } from './commitQueue';
import { applyPendingStops } from './pendingStops';
import { gatewayStore, type GatewayStore } from './store';

export const PAUSED_TASK_NAME = 'LazarusPausedInbox';

/** Args the Kotlin `PausedInboxTaskService` passes to the task. */
export interface PausedTaskArgs {
  readonly sender: string;
  readonly body: string;
  readonly receivedAt: number;
}

export interface PausedTaskDeps {
  /** Local offset east of UTC in minutes at `ms` (e.g. 300 for Pakistan). */
  readonly tzOffsetMinutes: (ms: number) => number;
  /** Shared write chain; defaults to one built over `ports.store` with the UI banner. */
  readonly commits?: CommitQueue;
  /** Defaults to the app-wide UI store. */
  readonly ui?: Pick<GatewayStore, 'addActivity' | 'setBanner' | 'setCounters'>;
  readonly log: LogFn;
}

export type PausedTask = (args: unknown) => Promise<void>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Strict decode at the native boundary; a malformed payload is dropped with a masked line. */
export function decodePausedArgs(raw: unknown, log: LogFn): PausedTaskArgs | null {
  if (isRecord(raw)) {
    const { sender, body, receivedAt } = raw;
    if (typeof sender === 'string' && sender.length > 0 && typeof body === 'string' && isTime(receivedAt)) {
      return { sender, body, receivedAt };
    }
  }
  const from = isRecord(raw) && typeof raw.sender === 'string' ? ` (from ${maskSender(raw.sender)})` : '';
  log(`pausedTask: dropped malformed args${from}`);
  return null;
}

function toInbound(args: PausedTaskArgs): InboundMessage {
  // No native row exists for a paused message; the id is opaque and never stored.
  return { id: `paused-${args.receivedAt}`, seq: 0, ...args };
}

async function loadReadableState(ports: GatewayPorts, today: string): Promise<GatewayState | null> {
  try {
    const decoded = await ports.store.loadState(today);
    return decoded.status === 'ok' ? decoded.state : null;
  } catch {
    return null;
  }
}

interface Context {
  readonly ports: GatewayPorts;
  readonly commits: CommitQueue;
  readonly ui: NonNullable<PausedTaskDeps['ui']>;
  readonly log: LogFn;
}

async function appendEntry(c: Context, entry: ActivityEntry): Promise<void> {
  try {
    await c.commits.appendActivity(entry);
    c.ui.addActivity(entry);
  } catch {
    c.log(`pausedTask: activity append failed (from ${entry.who})`);
  }
}

/** Last resort for a STOP: the next start applies it (Requirements 9.11, 9.13). */
async function savePendingStop(c: Context, args: PausedTaskArgs): Promise<void> {
  try {
    await c.ports.store.savePendingStop(args.sender, args.receivedAt);
    c.log(`pausedTask: STOP kept as pending stop (from ${maskSender(args.sender)})`);
  } catch {
    c.log(`pausedTask: pending stop write failed, STOP lost (from ${maskSender(args.sender)})`);
  }
}

/** Stop_List or state unreadable: no pipeline run, but a STOP is still kept. */
async function handleWithoutState(c: Context, args: PausedTaskArgs): Promise<void> {
  c.log(`pausedTask: state unreadable (from ${maskSender(args.sender)})`);
  const routed = routeCommand(args.body);
  if (routed.command === 'STOP') {
    await savePendingStop(c, args);
    return;
  }
  await appendEntry(c, {
    receivedAt: args.receivedAt,
    who: maskSender(args.sender),
    command: routed.command,
    outcome: 'ignored-paused',
  });
}

async function commitDecision(
  c: Context,
  decision: GatewayDecision,
  state: GatewayState,
  today: string,
): Promise<boolean> {
  const final = finalizeSend(decision, null, state.counters, today); // 0 parts: counters only
  const changes: StateChange[] = [...decision.changes, ...final.changes];
  try {
    await c.commits.enqueue(changes);
    const counters = applyChanges(state, final.changes).counters;
    c.ui.setCounters(counters);
    return true;
  } catch {
    c.log(`pausedTask: commit failed (from ${buildActivityEntry(decision, decision.outcome).who})`);
    return false;
  }
}

async function handle(c: Context, args: PausedTaskArgs, today: string): Promise<void> {
  const loaded = await loadReadableState(c.ports, today);
  if (loaded === null) {
    await handleWithoutState(c, args);
    return;
  }
  const pending = await applyPendingStops(c.ports, loaded, { commits: c.commits, log: c.log });
  for (const entry of pending.entries) c.ui.addActivity(entry);
  const state = pending.state;
  const decision = await runGatewayPipeline(toInbound(args), state, { paused: true, today }, {
    answer: null,
  });
  const committed = await commitDecision(c, decision, state, today);
  if (!committed && decision.outcome === 'stopped') {
    // The Pending_Stop_Record adds the Activity_Entry when it is applied (9.15).
    await savePendingStop(c, args);
    return;
  }
  await appendEntry(c, buildActivityEntry(decision, decision.outcome));
}

/** Testable task factory. The returned task never rejects. */
export function createPausedTask(ports: GatewayPorts, deps: PausedTaskDeps): PausedTask {
  const ui = deps.ui ?? gatewayStore;
  const commits =
    deps.commits ??
    createCommitQueue({
      store: ports.store,
      onStopListSaveFailed: () => ui.setBanner('stop-list-save-failed', true),
      log: deps.log,
    });
  const c: Context = { ports, commits, ui, log: deps.log };
  return async (raw) => {
    const args = decodePausedArgs(raw, deps.log);
    if (args === null) return;
    const today = localDayKey(args.receivedAt, deps.tzOffsetMinutes(args.receivedAt));
    try {
      await handle(c, args, today);
    } catch {
      deps.log(`pausedTask: failed (from ${maskSender(args.sender)})`);
    }
  };
}

/** Phone's local offset east of UTC at `ms`. */
export function deviceTzOffsetMinutes(ms: number): number {
  return -new Date(ms).getTimezoneOffset();
}

const defaultLog: LogFn = (line) => console.warn(line);
let liveTask: PausedTask | null = null;

/** Registered as `LazarusPausedInbox`; builds the live ports on first use. */
export default function lazarusPausedInbox(args: unknown): Promise<void> {
  if (liveTask === null) {
    liveTask = createPausedTask(createLivePorts(defaultLog), {
      tzOffsetMinutes: deviceTzOffsetMinutes,
      log: defaultLog,
    });
  }
  return liveTask(args);
}
