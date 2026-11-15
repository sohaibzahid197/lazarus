// Commit queue: one write chain, Stop_List retries and banner (Requirements 3.6, 3.12).
import type { ActivityEntry, CanonicalNumber, StateChange } from '@lazarus/brain';
import {
  STOP_LIST_RETRIES,
  STOP_LIST_RETRY_MS,
  createCommitQueue,
  type CommitQueue,
} from '../src/gateway/commitQueue';
import { createMockPorts, type MockPorts } from './support/mockPorts';

const NUMBER = '+923001234567' as CanonicalNumber;
const STOP: StateChange[] = [{ type: 'stop-add', number: NUMBER }];
const UNSTOP: StateChange[] = [{ type: 'stop-remove', number: NUMBER }];
const RATE: StateChange[] = [{ type: 'rate-record', number: NUMBER, at: 1 }];
const STOP_WITH_REMINDERS: StateChange[] = [
  { type: 'stop-add', number: NUMBER },
  { type: 'reminder-remove-all', number: NUMBER },
];
const REMINDERS_ONLY: StateChange[] = [{ type: 'reminder-remove-all', number: NUMBER }];
const ENTRY: ActivityEntry = { receivedAt: 1, who: '••••567', command: 'STOP', outcome: 'stopped' };

interface Setup {
  readonly mock: MockPorts;
  readonly queue: CommitQueue;
  readonly banner: jest.Mock;
  readonly logs: string[];
}

function setup(): Setup {
  const mock = createMockPorts();
  const banner = jest.fn();
  const logs: string[] = [];
  const queue = createCommitQueue({
    store: mock.ports.store,
    onStopListSaveFailed: banner,
    log: (line) => logs.push(line),
  });
  return { mock, queue, banner, logs };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('commit queue ordering', () => {
  it('starts a write only after the previous one settles', async () => {
    const { mock, queue } = setup();
    const gate = deferred();
    mock.scripts.commit.setDefault(() => gate.promise);
    const first = queue.enqueue(RATE);
    const second = queue.appendActivity(ENTRY);
    await mock.settle();
    expect(mock.names()).toEqual(['commit']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(mock.names()).toEqual(['commit', 'appendActivity']);
  });

  it('keeps the chain going after a failed write and reports each result', async () => {
    const { mock, queue } = setup();
    mock.scripts.appendActivity.reject('disk full');
    const failed = queue.appendActivity(ENTRY);
    const next = queue.enqueue(RATE);
    await expect(failed).rejects.toThrow('disk full');
    await expect(next).resolves.toBeUndefined();
    expect(mock.names()).toEqual(['appendActivity', 'commit']);
  });

  it('does not retry a batch without Stop_List changes', async () => {
    const { mock, queue, banner } = setup();
    mock.scripts.commit.reject('busy');
    await expect(queue.enqueue(RATE)).rejects.toThrow('busy');
    expect(mock.callsTo('commit')).toHaveLength(1);
    expect(banner).not.toHaveBeenCalled();
  });

  it('skips the store for an empty batch', async () => {
    const { mock, queue } = setup();
    await queue.enqueue([]);
    expect(mock.calls).toHaveLength(0);
  });

  it('returns the write result for applyPendingStop', async () => {
    const { mock, queue } = setup();
    mock.scripts.applyPendingStop.resolve(false);
    await expect(queue.applyPendingStop(4, STOP, ENTRY)).resolves.toBe(false);
    expect(mock.callsTo('applyPendingStop')[0].args).toEqual([4, STOP, ENTRY]);
  });
});

describe('Stop_List retries', () => {
  it('retries at 1 s intervals and resolves when a retry succeeds', async () => {
    const { mock, queue, banner } = setup();
    mock.scripts.commit.reject('locked', 2);
    const result = queue.enqueue(STOP);
    await mock.settle();
    expect(mock.callsTo('commit')).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(STOP_LIST_RETRY_MS - 1);
    expect(mock.callsTo('commit')).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(mock.callsTo('commit')).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(STOP_LIST_RETRY_MS);
    await expect(result).resolves.toBeUndefined();
    expect(mock.callsTo('commit')).toHaveLength(3);
    expect(banner).not.toHaveBeenCalled();
  });

  it('raises the banner and rejects after 3 failed retries, then runs the next write', async () => {
    const { mock, queue, banner, logs } = setup();
    mock.scripts.commit.reject('locked', 1 + STOP_LIST_RETRIES);
    const result = queue.enqueue(UNSTOP);
    const outcome = result.then(
      () => 'resolved',
      (e: unknown) => (e instanceof Error ? e.message : 'rejected'),
    );
    const next = queue.appendActivity(ENTRY);
    await jest.advanceTimersByTimeAsync(STOP_LIST_RETRIES * STOP_LIST_RETRY_MS - 1);
    expect(banner).not.toHaveBeenCalled();
    expect(mock.names()).toEqual(['commit', 'commit', 'commit']);
    await jest.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe('locked');
    expect(mock.callsTo('commit')).toHaveLength(1 + STOP_LIST_RETRIES);
    expect(banner).toHaveBeenCalledTimes(1);
    await expect(next).resolves.toBeUndefined();
    expect(mock.names().at(-1)).toBe('appendActivity');
    expect(logs.join('\n')).not.toContain('3001234567');
  });

  it('retries a STOP batch with its reminder removal as one Stop_List write (sms-reminders 8.1, 8.6)', async () => {
    const { mock, queue, banner } = setup();
    mock.scripts.commit.reject('locked', 1);
    const result = queue.enqueue(STOP_WITH_REMINDERS);
    await jest.advanceTimersByTimeAsync(STOP_LIST_RETRY_MS);
    await expect(result).resolves.toBeUndefined();
    expect(mock.callsTo('commit').map((c) => c.args[0])).toEqual([STOP_WITH_REMINDERS, STOP_WITH_REMINDERS]);
    expect(banner).not.toHaveBeenCalled();
  });

  it('does not retry a reminder-only batch as a Stop_List write', async () => {
    const { mock, queue, banner } = setup();
    mock.scripts.commit.reject('busy');
    await expect(queue.enqueue(REMINDERS_ONLY)).rejects.toThrow('busy');
    expect(mock.callsTo('commit')).toHaveLength(1);
    expect(banner).not.toHaveBeenCalled();
  });

  it('retries applyPendingStop when it changes the Stop_List', async () => {
    const { mock, queue, banner } = setup();
    mock.scripts.applyPendingStop.alwaysReject('locked');
    const result = queue.applyPendingStop(1, STOP, ENTRY).catch(() => 'rejected');
    await jest.advanceTimersByTimeAsync(STOP_LIST_RETRIES * STOP_LIST_RETRY_MS);
    expect(await result).toBe('rejected');
    expect(mock.callsTo('applyPendingStop')).toHaveLength(1 + STOP_LIST_RETRIES);
    expect(banner).toHaveBeenCalledTimes(1);
  });
});
