// Loop glue (task 22.8): start order, commit ordering, STOP handling, load and write
// failures, and an unreadable Gemini_Api_Key.
// Requirements 3.6, 3.9, 3.11, 3.12, 14.12, 16.20.
import { FIXED_TEXTS, type CanonicalNumber } from '@lazarus/brain';
import { STOP_LIST_RETRIES } from '../src/gateway/commitQueue';
import { startGatewayLoop, type Clock, type GatewayLoop } from '../src/gateway/loop';
import { LOAD_RETRY_MS } from '../src/gateway/loopSupport';
import { createGatewayStore, type GatewayStore } from '../src/gateway/store';
import {
  createMockPorts,
  emptyState,
  inbound,
  type CallRecord,
  type MockPorts,
} from './support/mockPorts';

const A = '+923001111111' as CanonicalNumber;
const B = '+923002222222' as CanonicalNumber;
const C = '+923003333333' as CanonicalNumber;
const T0 = Date.UTC(2026, 0, 15, 5, 0, 0);

interface Sleeper {
  readonly ms: number;
  readonly release: () => void;
}

/**
 * Fake clock. Without `gated`, every sleep resolves at once; with it, each sleep
 * waits until the test calls `release()` on its entry in `sleeps`.
 */
function fakeClock(gated = false): Clock & { readonly sleeps: Sleeper[] } {
  const sleeps: Sleeper[] = [];
  return {
    sleeps,
    now: () => T0,
    tzOffsetMinutes: () => 300,
    sleep: (ms) => {
      if (!gated) return Promise.resolve();
      return new Promise<void>((resolve) => {
        sleeps.push({ ms, release: resolve });
      });
    },
  };
}

/** Promise the test opens by calling `open()`. */
function gate(): { readonly wait: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

/** Yields full event-loop turns until `cond` holds. */
async function waitFor(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (cond()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Gives the loop `n` full event-loop turns to (wrongly) make progress. */
async function turns(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

let loop: GatewayLoop | null = null;

afterEach(async () => {
  await loop?.stop();
  loop = null;
});

interface Harness {
  readonly mock: MockPorts;
  readonly ui: GatewayStore;
  readonly logs: string[];
  readonly clock: ReturnType<typeof fakeClock>;
}

function start(mock: MockPorts = createMockPorts(), clock = fakeClock()): Harness {
  const ui = createGatewayStore();
  const logs: string[] = [];
  loop = startGatewayLoop(mock.ports, clock, { ui, log: (line) => logs.push(line) });
  return { mock, ui, logs, clock };
}

const indexOf = (mock: MockPorts, pred: (c: CallRecord) => boolean): number =>
  mock.calls.findIndex(pred);
const isCall = (method: string, ...args: unknown[]) => (c: CallRecord): boolean =>
  c.method === method && args.every((a, i) => c.args[i] === a);
const commitsStop = (c: CallRecord): boolean =>
  c.method === 'commit' &&
  (c.args[0] as readonly { type: string }[]).some((ch) => ch.type === 'stop-add');
const outcomes = (mock: MockPorts): string[] =>
  mock.callsTo('appendActivity').map((c) => (c.args[0] as { outcome: string }).outcome);

function expectNoBodies(logs: readonly string[], bodies: readonly string[]): void {
  for (const line of logs) {
    for (const body of bodies) expect(line).not.toContain(body);
    expect(line).not.toMatch(/\d{4}/);
  }
}

describe('start order', () => {
  it('loads state, reads the key, applies Pending_Stop_Records, attaches, then takes', async () => {
    const mock = createMockPorts();
    mock.addPendingStop(C, T0 - 1000);
    mock.pushInbound(inbound('m1', B, 'HELP', T0));
    start(mock);
    await waitFor(() => mock.callsTo('completeInbound').length === 1, 'm1 completed');

    const order = mock.names([
      'loadState',
      'readKey',
      'takePendingStops',
      'applyPendingStop',
      'attachLoop',
      'takeNextInbound',
    ]);
    expect(order.slice(0, 6)).toEqual([
      'loadState',
      'readKey',
      'takePendingStops',
      'applyPendingStop',
      'attachLoop',
      'takeNextInbound',
    ]);
  });
});

describe('per-message ordering', () => {
  it('awaits the Stop_List commit before completeInbound and the next take (3.6, 3.9)', async () => {
    const h = start();
    const { mock } = h;
    await waitFor(() => mock.callsTo('attachLoop').length === 1, 'attachLoop');
    const commitGate = gate();
    mock.scripts.commit.setDefault(() => commitGate.wait);

    mock.pushInbound(inbound('m1', A, 'STOP', T0), inbound('m2', B, 'HELP', T0 + 1));
    await waitFor(() => mock.calls.some(commitsStop), 'STOP commit');
    await turns();
    // Held on the commit: m2 is still in the inbox and m1 is not completed.
    expect(mock.inbox.map((m) => m.id)).toEqual(['m2']);
    expect(mock.callsTo('completeInbound')).toHaveLength(0);
    expect(mock.callsTo('cancelPendingSends')).toHaveLength(0);

    commitGate.open();
    await waitFor(() => mock.callsTo('completeInbound').length === 2, 'm2 completed');

    const commitAt = indexOf(mock, commitsStop);
    const completeAt = indexOf(mock, isCall('completeInbound', 'm1'));
    const cancelAt = indexOf(mock, isCall('cancelPendingSends', A));
    const nextTakeAt = mock.calls.findIndex((c, i) => i > commitAt && c.method === 'takeNextInbound');
    expect(commitAt).toBeGreaterThanOrEqual(0);
    expect(completeAt).toBeGreaterThan(commitAt);
    expect(cancelAt).toBeGreaterThan(completeAt);
    expect(nextTakeAt).toBeGreaterThan(cancelAt);
    expect(mock.callsTo('cancelPendingSends')).toHaveLength(1);
    expect(mock.callsTo('sendParts').map((c) => c.args[1])).toEqual([B]);
  });
});

describe('Stop_List save failure (3.12)', () => {
  it('retries 3 times, raises the banner, keeps processing and keeps STOP in memory', async () => {
    const h = start();
    const { mock, ui } = h;
    await waitFor(() => mock.callsTo('attachLoop').length === 1, 'attachLoop');
    mock.scripts.commit.reject('disk full', STOP_LIST_RETRIES + 1);

    mock.pushInbound(inbound('m1', A, 'STOP', T0));
    await waitFor(() => ui.getSnapshot().banners.includes('stop-list-save-failed'), 'banner');
    expect(mock.calls.filter(commitsStop)).toHaveLength(STOP_LIST_RETRIES + 1);

    mock.pushInbound(inbound('m2', A, 'HELP', T0 + 1), inbound('m3', B, 'HELP', T0 + 2));
    await waitFor(() => mock.callsTo('appendActivity').length === 3, 'three activity entries');
    expect(mock.callsTo('completeInbound').map((c) => c.args[0])).toEqual(['m1', 'm2', 'm3']);
    expect(outcomes(mock)).toEqual(['stopped', 'ignored-stopped', 'replied']);
    expect(mock.callsTo('sendParts').map((c) => c.args[1])).toEqual([B]);
    expectNoBodies(h.logs, ['STOP', 'HELP', 'disk full']);
  });
});

describe('Stop_List unreadable (3.11)', () => {
  it('holds every message while loadState rejects, then processes once it loads', async () => {
    const mock = createMockPorts();
    mock.scripts.loadState.alwaysReject('io error');
    mock.pushInbound(inbound('m1', A, 'HELP', T0));
    const h = start(mock, fakeClock(true));
    const { ui, clock } = h;

    await waitFor(() => clock.sleeps.length === 1, 'first retry sleep');
    expect(clock.sleeps[0]?.ms).toBe(LOAD_RETRY_MS);
    expect(ui.getSnapshot().banners).toContain('stop-list-unreadable');
    expect(ui.getSnapshot().serviceStatus).toBe('stopped');

    clock.sleeps[0]?.release();
    await waitFor(() => clock.sleeps.length === 2, 'second retry sleep');
    expect(mock.callsTo('loadState')).toHaveLength(2);
    expect(mock.callsTo('takeNextInbound')).toHaveLength(0);
    expect(mock.callsTo('attachLoop')).toHaveLength(0);
    expect(mock.callsTo('sendParts')).toHaveLength(0);

    mock.scripts.loadState.setDefault((today) => emptyState(today));
    clock.sleeps[1]?.release();
    await waitFor(() => mock.callsTo('completeInbound').length === 1, 'm1 completed');
    expect(mock.callsTo('sendParts').map((c) => c.args[1])).toEqual([A]);
    expect(ui.getSnapshot().banners).not.toContain('stop-list-unreadable');
    expect(ui.getSnapshot().serviceStatus).toBe('running');
    expectNoBodies(h.logs, ['HELP', 'io error']);
  });
});

describe('activity write failure (14.12)', () => {
  it('keeps processing when appendActivity rejects', async () => {
    const mock = createMockPorts();
    mock.scripts.appendActivity.reject('activity db locked');
    const h = start(mock);
    await waitFor(() => mock.callsTo('attachLoop').length === 1, 'attachLoop');

    mock.pushInbound(inbound('m1', A, 'HELP', T0), inbound('m2', B, 'HELP', T0 + 1));
    await waitFor(() => mock.callsTo('appendActivity').length === 2, 'two activity writes');
    expect(mock.callsTo('completeInbound').map((c) => c.args[0])).toEqual(['m1', 'm2']);
    expect(mock.callsTo('sendParts').map((c) => c.args[1])).toEqual([A, B]);
    expect(h.ui.getSnapshot().activity).toHaveLength(2);
    expect(h.logs.some((l) => l.includes('activity append failed'))).toBe(true);
    expectNoBodies(h.logs, ['HELP', 'activity db locked']);
  });
});

describe('unreadable Gemini_Api_Key (16.20)', () => {
  it('keeps running, shows the banner and answers a QUESTION with the Try_Later_Text', async () => {
    const mock = createMockPorts();
    mock.scripts.readKey.resolve({ status: 'unreadable' });
    const h = start(mock);
    await waitFor(() => mock.callsTo('attachLoop').length === 1, 'attachLoop');
    expect(h.ui.getSnapshot().banners).toContain('ai-key-missing');

    mock.pushInbound(inbound('m1', A, 'what is rain?', T0));
    await waitFor(() => mock.callsTo('sendParts').length === 1, 'reply sent');
    expect(mock.callsTo('sendParts')[0]?.args[2]).toEqual([FIXED_TEXTS.en.tryLater]);
    expect(mock.callsTo('completeInbound').map((c) => c.args[0])).toEqual(['m1']);
    expectNoBodies(h.logs, ['what is rain?']);
  });
});
