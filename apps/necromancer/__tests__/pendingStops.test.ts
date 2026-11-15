// Pending_Stop_Records applied before any message (Requirements 9.15, 9.16, 3.12).
import { encodeReminder, type CanonicalNumber, type GatewayState, type ReminderId } from '@lazarus/brain';
import {
  STOP_LIST_RETRIES,
  STOP_LIST_RETRY_MS,
  createCommitQueue,
} from '../src/gateway/commitQueue';
import { applyPendingStops } from '../src/gateway/pendingStops';
import { createMockPorts, emptyState, type MockPorts } from './support/mockPorts';

const A = '+923001111111' as CanonicalNumber;
const B = '+923002222222' as CanonicalNumber;
const C = '+923003333333' as CanonicalNumber;

/** One active reminder per number, in wire format. */
function remindersFor(...numbers: CanonicalNumber[]): unknown[] {
  return numbers.map((number, i) =>
    encodeReminder({
      id: `r${i + 1}` as ReminderId,
      number,
      slot: 1,
      dueAt: 10_000 + i,
      text: 'take medicine',
      language: 'en',
      createdAt: 1,
      handedAt: null,
    }),
  );
}

function baseState(reminders: readonly unknown[] = []): GatewayState {
  const decoded = emptyState(undefined, reminders);
  if (decoded.status !== 'ok') throw new Error('mock state unreadable');
  return decoded.state;
}

function reminderNumbers(state: GatewayState): string[] {
  return state.reminders.status === 'ok' ? state.reminders.reminders.map((r) => r.number) : [];
}

function setup(
  reminders: readonly unknown[] = [],
): { mock: MockPorts; banner: jest.Mock; logs: string[]; run: () => ReturnType<typeof applyPendingStops> } {
  const mock = createMockPorts();
  const banner = jest.fn();
  const logs: string[] = [];
  const log = (line: string): void => {
    logs.push(line);
  };
  const commits = createCommitQueue({ store: mock.ports.store, onStopListSaveFailed: banner, log });
  const run = () => applyPendingStops(mock.ports, baseState(reminders), { commits, log });
  return { mock, banner, logs, run };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('applyPendingStops', () => {
  it('applies records by receive time, ties by id, and deletes each row', async () => {
    const { mock, run } = setup();
    const late = mock.addPendingStop(A, 300);
    const tieFirst = mock.addPendingStop(B, 100);
    const tieSecond = mock.addPendingStop(C, 100);
    const result = await run();
    expect(mock.callsTo('applyPendingStop').map((c) => c.args[0])).toEqual([tieFirst, tieSecond, late]);
    expect(mock.pendingStops).toHaveLength(0);
    expect([...result.state.stopList].sort()).toEqual([A, B, C].sort());
    expect(result.summary).toEqual({ applied: 3, failed: 0, alreadyGone: 0 });
    expect(result.entries.map((e) => [e.receivedAt, e.command, e.outcome])).toEqual([
      [100, 'STOP', 'stopped'],
      [100, 'STOP', 'stopped'],
      [300, 'STOP', 'stopped'],
    ]);
    expect(result.entries.map((e) => e.who).join(' ')).not.toContain('3001111111');
  });

  it('removes the reminders of each stopped number in the same write as its stop-add (8.1)', async () => {
    const { mock, run } = setup(remindersFor(A, B));
    mock.addPendingStop(A, 100);
    const result = await run();
    expect(mock.callsTo('applyPendingStop').map((c) => c.args[1])).toEqual([
      [
        { type: 'stop-add', number: A },
        { type: 'reminder-remove-all', number: A },
      ],
    ]);
    expect(reminderNumbers(result.state)).toEqual([B]);
  });

  it('deletes the row of an Automated_Sender record without a Stop_List change', async () => {
    const { mock, run } = setup();
    const id = mock.addPendingStop('JAZZ', 50);
    const result = await run();
    expect(mock.callsTo('applyPendingStop')[0].args.slice(0, 2)).toEqual([id, []]);
    expect(mock.pendingStops).toHaveLength(0);
    expect(result.state.stopList.size).toBe(0);
    expect(result.entries[0].outcome).toBe('ignored-automated');
  });

  it('keeps the row and the in-memory stop after 4 failed writes, raises the banner, and continues', async () => {
    const { mock, banner, logs, run } = setup(remindersFor(A));
    const failing = mock.addPendingStop(A, 100);
    mock.addPendingStop(B, 200);
    mock.scripts.applyPendingStop.reject('locked', 1 + STOP_LIST_RETRIES);
    const pending = run();
    await jest.advanceTimersByTimeAsync(STOP_LIST_RETRIES * STOP_LIST_RETRY_MS);
    const result = await pending;
    expect(mock.callsTo('applyPendingStop')).toHaveLength(1 + STOP_LIST_RETRIES + 1);
    expect(mock.pendingStops.map((r) => r.id)).toEqual([failing]);
    expect(result.state.stopList.has(A)).toBe(true);
    expect(result.state.stopList.has(B)).toBe(true);
    expect(reminderNumbers(result.state)).toEqual([]); // removal kept in memory (8.6)
    for (const c of mock.callsTo('applyPendingStop').slice(0, 1 + STOP_LIST_RETRIES)) {
      expect(c.args[1]).toContainEqual({ type: 'reminder-remove-all', number: A });
    }
    expect(result.summary).toEqual({ applied: 1, failed: 1, alreadyGone: 0 });
    expect(result.entries).toHaveLength(1);
    expect(banner).toHaveBeenCalledTimes(1);
    expect(logs.join('\n')).not.toMatch(/300[12]/);
  });

  it('treats a row that is already gone as no failure', async () => {
    const { mock, banner, run } = setup();
    mock.addPendingStop(A, 100);
    mock.scripts.applyPendingStop.resolve(false);
    const result = await run();
    expect(result.summary).toEqual({ applied: 0, failed: 0, alreadyGone: 1 });
    expect(result.state.stopList.has(A)).toBe(true);
    expect(banner).not.toHaveBeenCalled();
  });

  it('returns the state unchanged when the rows cannot be read', async () => {
    const { mock, run } = setup();
    mock.scripts.takePendingStops.reject('io');
    const result = await run();
    expect(result.summary).toEqual({ applied: 0, failed: 0, alreadyGone: 0 });
    expect(mock.callsTo('applyPendingStop')).toHaveLength(0);
  });
});
