// Paused path and Pending_Stop_Records (task 22.9; Requirements 9.10, 9.12, 9.13, 9.15,
// 9.16, 14.13, 18.14; design decision D3 / Requirement 13.16).
import type { StateChange } from '@lazarus/brain';
import { createCommitQueue } from '../src/gateway/commitQueue';
import { startGatewayLoop, type Clock, type GatewayLoop } from '../src/gateway/loop';
import { createPausedTask } from '../src/gateway/pausedTask';
import { createGatewayStore } from '../src/gateway/store';
import { createMockPorts, inbound, type MockPorts } from './support/mockPorts';

const A = '+923001234567';
const AT = Date.UTC(2026, 0, 15, 6, 0, 0);
const PK_OFFSET = 300;

const fakeClock: Clock = {
  now: () => AT,
  tzOffsetMinutes: () => PK_OFFSET,
  sleep: () => Promise.resolve(),
};

/** Runs macrotask turns until `cond` holds; fails after `turns`. */
async function waitFor(cond: () => boolean, turns = 500): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (cond()) return;
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0);
    });
  }
  throw new Error('waitFor: condition not met');
}

function pausedSetup() {
  const mock = createMockPorts();
  const ui = createGatewayStore();
  const logs: string[] = [];
  const log = (line: string): void => {
    logs.push(line);
  };
  const commits = createCommitQueue({
    store: mock.ports.store,
    onStopListSaveFailed: () => ui.setBanner('stop-list-save-failed', true),
    sleep: () => Promise.resolve(),
    log,
  });
  const task = createPausedTask(mock.ports, { tzOffsetMinutes: () => PK_OFFSET, commits, ui, log });
  return { mock, ui, logs, task };
}

let loops: GatewayLoop[] = [];
function startLoop(mock: MockPorts): GatewayLoop {
  const loop = startGatewayLoop(mock.ports, fakeClock, {
    ui: createGatewayStore(),
    log: () => undefined,
  });
  loops.push(loop);
  return loop;
}

afterEach(async () => {
  for (const loop of loops) await loop.stop();
  loops = [];
});

function outcomesFor(mock: MockPorts): string[] {
  return mock
    .callsTo('appendActivity')
    .map((c) => (c.args[0] as { outcome: string }).outcome);
}

function firstIndex(mock: MockPorts, method: Parameters<MockPorts['callsTo']>[0]): number {
  return mock.calls.findIndex((c) => c.method === method);
}

describe('paused STOP whose commit fails', () => {
  it('stores only sender, STOP marker and receive time, with no body text', async () => {
    const { mock, logs, task } = pausedSetup();
    mock.scripts.commit.alwaysReject('disk full');

    await task({ sender: A, body: 'STOP please call me', receivedAt: AT });

    // Every attempt carried the reminder removal with the Stop_List change (sms-reminders 8.1).
    expect(mock.callsTo('commit').length).toBeGreaterThan(0);
    for (const c of mock.callsTo('commit')) {
      const changes = c.args[0] as StateChange[];
      expect(changes).toContainEqual({ type: 'stop-add', number: A });
      expect(changes).toContainEqual({ type: 'reminder-remove-all', number: A });
    }
    expect(mock.callsTo('savePendingStop').map((c) => c.args)).toEqual([[A, AT]]);
    expect(mock.pendingStops).toHaveLength(1);
    const record = mock.pendingStops[0];
    expect(Object.keys(record ?? {}).sort()).toEqual(['id', 'marker', 'receivedAt', 'sender']);
    expect(record).toEqual({ id: expect.any(Number), sender: A, marker: 'STOP', receivedAt: AT });

    const everything = JSON.stringify([mock.calls, mock.pendingStops, logs]);
    expect(everything).not.toContain('please');
    expect(everything).not.toContain('call me');
    expect(mock.callsTo('startService')).toHaveLength(0);
  });
});

describe('Pending_Stop_Record applied before any message (9.15)', () => {
  it('applies the record before a Pending_Inbox message is taken', async () => {
    const mock = createMockPorts();
    const id = mock.addPendingStop(A, AT - 60_000);
    mock.pushInbound(inbound('m1', A, 'HELP', AT));

    startLoop(mock);
    await waitFor(() => mock.callsTo('completeInbound').length === 1 && outcomesFor(mock).length === 1);

    expect(mock.callsTo('applyPendingStop')[0]?.args[0]).toBe(id);
    expect(mock.callsTo('applyPendingStop')[0]?.args[1]).toEqual([
      { type: 'stop-add', number: A },
      { type: 'reminder-remove-all', number: A },
    ]);
    expect(firstIndex(mock, 'applyPendingStop')).toBeLessThan(firstIndex(mock, 'takeNextInbound'));
    expect(mock.callsTo('applyPendingStop')[0]?.args[2]).toEqual(
      expect.objectContaining({ outcome: 'stopped', command: 'STOP' }),
    );
    expect(outcomesFor(mock)).toEqual(['ignored-stopped']);
    expect(mock.callsTo('sendParts')).toHaveLength(0);
  });

  it('applies the record before a live message is taken', async () => {
    const mock = createMockPorts();
    mock.addPendingStop(A, AT - 60_000);

    startLoop(mock);
    await waitFor(() => mock.callsTo('waitForInbound').length === 1);
    mock.pushInbound(inbound('m2', A, 'HELP', AT));
    await waitFor(() => mock.callsTo('completeInbound').length === 1 && outcomesFor(mock).length === 1);

    expect(firstIndex(mock, 'applyPendingStop')).toBeLessThan(firstIndex(mock, 'takeNextInbound'));
    expect(mock.callsTo('applyPendingStop')[0]?.args[2]).toEqual(
      expect.objectContaining({ outcome: 'stopped', command: 'STOP' }),
    );
    expect(outcomesFor(mock)).toEqual(['ignored-stopped']);
    expect(mock.callsTo('sendParts')).toHaveLength(0);
  });
});

describe('Pending_Stop_Record delete and keep (9.16)', () => {
  it('deletes the record after success, so the next start does not apply it again', async () => {
    const mock = createMockPorts();
    mock.addPendingStop(A, AT - 60_000);

    const first = startLoop(mock);
    await waitFor(() => mock.callsTo('attachLoop').length === 1);
    expect(mock.callsTo('applyPendingStop')).toHaveLength(1);
    expect(mock.pendingStops).toHaveLength(0);
    await first.stop();

    startLoop(mock);
    await waitFor(() => mock.callsTo('attachLoop').length === 2);
    expect(mock.callsTo('applyPendingStop')).toHaveLength(1);
  });

  it('keeps the record after 4 failures, still blocks the number, and applies it on the next start', async () => {
    const mock = createMockPorts();
    const id = mock.addPendingStop(A, AT - 60_000);
    mock.scripts.applyPendingStop.reject('disk full', 4);

    const first = startLoop(mock);
    await waitFor(() => mock.callsTo('attachLoop').length === 1);
    expect(mock.callsTo('applyPendingStop')).toHaveLength(4);
    expect(mock.pendingStops.map((r) => r.id)).toEqual([id]);

    mock.pushInbound(inbound('m3', A, 'HELP', AT));
    await waitFor(() => mock.callsTo('completeInbound').length === 1 && outcomesFor(mock).length === 1);
    expect(outcomesFor(mock)).toEqual(['ignored-stopped']);
    expect(mock.callsTo('sendParts')).toHaveLength(0);
    await first.stop();

    startLoop(mock);
    await waitFor(() => mock.callsTo('attachLoop').length === 2);
    expect(mock.callsTo('applyPendingStop').map((c) => c.args[0])).toEqual([id, id, id, id, id]);
    expect(mock.pendingStops).toHaveLength(0);
  });
});

describe('paused HELP (9.10, 9.12, 13.16)', () => {
  it('records ignored-paused with one counters-only commit and no service, AI or pending stop', async () => {
    const { mock, ui, task } = pausedSetup();

    await task({ sender: A, body: 'HELP', receivedAt: AT });

    expect(mock.callsTo('appendActivity').map((c) => c.args[0])).toEqual([
      expect.objectContaining({ outcome: 'ignored-paused', command: 'HELP', receivedAt: AT }),
    ]);
    const commits = mock.callsTo('commit').map((c) => c.args[0] as StateChange[]);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.map((ch) => ch.type)).toEqual(['counters']);
    expect(mock.callsTo('savePendingStop')).toHaveLength(0);
    expect(mock.callsTo('startService')).toHaveLength(0);
    expect(mock.callsTo('resumeService')).toHaveLength(0);
    expect(mock.callsTo('readKey')).toHaveLength(0);
    expect(mock.callsTo('sendParts')).toHaveLength(0);
    expect(ui.getSnapshot().counters?.ignored).toBe(1);
  });
});
