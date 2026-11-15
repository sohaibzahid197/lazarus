// One promise chain for every store write (necromancer-sms-gateway design, "JS glue").
// A send finalization never interleaves with a pipeline commit: each write starts only
// after the previous one has settled. A failed write never breaks the chain; the next
// write still runs, and each caller gets its own write's result (Requirement 3.6).
//
// Batches that change the Stop_List (`stop-add` / `stop-remove`) are retried up to
// 3 times at 1-second intervals. If all 3 retries fail, `onStopListSaveFailed` raises
// the "Stop list could not be saved" banner and the write rejects (Requirement 3.12).
// The in-memory Stop_List keeps the change; that is the caller's job.
//
// Log lines never hold a number, a body or an error message (it could echo either).
import type { ActivityEntry, StateChange } from '@lazarus/brain';
import type { LogFn, StorePort } from '../native/ports';

export const STOP_LIST_RETRIES = 3;
export const STOP_LIST_RETRY_MS = 1000;

export type Sleep = (ms: number) => Promise<void>;

export interface CommitQueueDeps {
  readonly store: Pick<StorePort, 'commit' | 'appendActivity' | 'applyPendingStop'>;
  /** Raises the "Stop list could not be saved" banner. */
  readonly onStopListSaveFailed: () => void;
  /** Defaults to `setTimeout`; tests pass a fake-timer-friendly one or use Jest fake timers. */
  readonly sleep?: Sleep;
  readonly log?: LogFn;
}

export interface WriteOptions {
  /** Retry 3 times at 1 s, then raise the banner (Requirement 3.12). */
  readonly stopList: boolean;
  /** Short label for log lines, e.g. 'commit'. Never data. */
  readonly label: string;
}

export interface CommitQueue {
  /** `store.commit(changes)`; an empty batch resolves without a store call. */
  enqueue(changes: readonly StateChange[]): Promise<void>;
  appendActivity(entry: ActivityEntry): Promise<void>;
  /** `store.applyPendingStop`; retried like a Stop_List batch when `changes` touch it. */
  applyPendingStop(
    id: number,
    changes: readonly StateChange[],
    entry: ActivityEntry,
  ): Promise<boolean>;
  /** Any other write, run in the same chain. */
  run<T>(write: () => Promise<T>, options: WriteOptions): Promise<T>;
  /** Resolves once every write queued so far has settled. */
  idle(): Promise<void>;
}

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const noLog: LogFn = () => undefined;

export function touchesStopList(changes: readonly StateChange[]): boolean {
  return changes.some((c) => c.type === 'stop-add' || c.type === 'stop-remove');
}

async function withStopListRetries<T>(
  write: () => Promise<T>,
  label: string,
  sleep: Sleep,
  log: LogFn,
): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await write();
    } catch (error: unknown) {
      if (retry >= STOP_LIST_RETRIES) throw error;
      log(`commitQueue: ${label} failed, retry ${retry + 1} of ${STOP_LIST_RETRIES}`);
      await sleep(STOP_LIST_RETRY_MS);
    }
  }
}

export function createCommitQueue(deps: CommitQueueDeps): CommitQueue {
  const sleep = deps.sleep ?? defaultSleep;
  const log = deps.log ?? noLog;
  let tail: Promise<void> = Promise.resolve();

  const attempt = async <T>(write: () => Promise<T>, options: WriteOptions): Promise<T> => {
    if (!options.stopList) return write();
    try {
      return await withStopListRetries(write, options.label, sleep, log);
    } catch (error: unknown) {
      log(`commitQueue: ${options.label} failed after ${STOP_LIST_RETRIES} retries`);
      deps.onStopListSaveFailed();
      throw error;
    }
  };

  const run = <T>(write: () => Promise<T>, options: WriteOptions): Promise<T> => {
    const result = tail.then(() => attempt(write, options));
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    enqueue: (changes) =>
      run(
        () => (changes.length === 0 ? Promise.resolve() : deps.store.commit(changes)),
        { stopList: touchesStopList(changes), label: 'commit' },
      ),
    appendActivity: (entry) =>
      run(() => deps.store.appendActivity(entry), { stopList: false, label: 'appendActivity' }),
    applyPendingStop: (id, changes, entry) =>
      run(() => deps.store.applyPendingStop(id, changes, entry), {
        stopList: touchesStopList(changes),
        label: 'applyPendingStop',
      }),
    run,
    idle: () => tail,
  };
}
