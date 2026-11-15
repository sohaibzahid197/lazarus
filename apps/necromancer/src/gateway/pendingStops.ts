// Applies stored Pending_Stop_Records before any other message is processed
// (necromancer-sms-gateway design, "Paused path"; Requirements 9.15, 9.16, 3.12).
//
// `gateway.takePendingStops()` already decodes each row with `decodePendingStopRecord`
// and leaves malformed rows in storage, so this module only orders and applies them.
// Each record goes through brain's `applyPendingStop`, then the commit queue's
// `applyPendingStop`, which writes the Stop_List change, the Activity_Entry and the row
// delete in one transaction and retries 3 times at 1 s (raising the banner on final
// failure). A failed write leaves the row for the next start; the in-memory state keeps
// the `stop-add` either way, so STOP still wins in this process.
//
// Log lines never hold a number, a body or an error message.
import {
  applyChanges,
  applyPendingStop,
  buildActivityEntry,
  orderPendingStops,
  type ActivityEntry,
  type GatewayState,
  type PendingStopRecord,
} from '@lazarus/brain';
import type { GatewayPorts, LogFn } from '../native/ports';
import type { CommitQueue } from './commitQueue';

export interface PendingStopsDeps {
  /** Shared write chain; it owns the Stop_List retries and the banner. */
  readonly commits: Pick<CommitQueue, 'applyPendingStop'>;
  readonly log?: LogFn;
}

export interface PendingStopsSummary {
  /** Rows written and deleted by this call. */
  readonly applied: number;
  /** Rows whose write failed after the retries; they stay in storage. */
  readonly failed: number;
  /** Rows another task had already applied (`applyPendingStop` resolved false). */
  readonly alreadyGone: number;
}

export interface PendingStopsResult {
  /** Every `stop-add` applied, including those whose write failed. */
  readonly state: GatewayState;
  readonly summary: PendingStopsSummary;
  /** Activity_Entries that were persisted, in apply order, for the UI store. */
  readonly entries: readonly ActivityEntry[];
}

type RecordResult = 'applied' | 'failed' | 'gone';

const noLog: LogFn = () => undefined;

async function readRecords(ports: GatewayPorts, log: LogFn): Promise<PendingStopRecord[] | null> {
  try {
    return await ports.gateway.takePendingStops();
  } catch {
    log('pendingStops: read failed, rows kept for the next start');
    return null;
  }
}

async function persist(
  commits: PendingStopsDeps['commits'],
  record: PendingStopRecord,
  decision: ReturnType<typeof applyPendingStop>,
  entry: ActivityEntry,
): Promise<RecordResult> {
  try {
    const deleted = await commits.applyPendingStop(record.id, decision.changes, entry);
    return deleted ? 'applied' : 'gone';
  } catch {
    return 'failed';
  }
}

export async function applyPendingStops(
  ports: GatewayPorts,
  state: GatewayState,
  deps: PendingStopsDeps,
): Promise<PendingStopsResult> {
  const log = deps.log ?? noLog;
  const records = await readRecords(ports, log);
  let current = state;
  const entries: ActivityEntry[] = [];
  const counts = { applied: 0, failed: 0, gone: 0 };
  for (const record of orderPendingStops(records ?? [])) {
    const decision = applyPendingStop(record, current);
    const entry = buildActivityEntry(decision, decision.outcome);
    current = applyChanges(current, decision.changes); // kept even if the write fails (9.16)
    const result = await persist(deps.commits, record, decision, entry);
    counts[result]++;
    if (result === 'applied') entries.push(entry);
    if (result === 'failed') log('pendingStops: apply failed, row kept for the next start');
  }
  return {
    state: current,
    summary: { applied: counts.applied, failed: counts.failed, alreadyGone: counts.gone },
    entries,
  };
}
