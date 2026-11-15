// Reminders in the gateway loop (sms-reminders task 18.9): start order, wake on
// `onRemindersDue`, runs only between Inbound_Messages, pause and resume, STOP wins,
// Stop_List and Reminder_Store read failures, a failed REMIND commit and the alarm
// reschedule after every reminder change.
// Requirements 8.1, 10.12, 11.7, 11.15, 12.7, 12.11, 14.7.
import { REMINDER_TEXTS, splitSms, type CanonicalNumber } from '@lazarus/brain';
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
const T0 = Date.UTC(2026, 0, 15, 5, 0, 0);
const MINUTE = 60_000;

interface Sleeper {
  readonly ms: number;
  readonly release: () => void;
}

type TestClock = Clock & { readonly sleeps: Sleeper[]; set(ms: number): void };

/** Fake clock with a settable `now`. With `gated`, each sleep waits for `release()`. */
function fakeClock(gated = false): TestClock {
  const sleeps: Sleeper[] = [];
  let now = T0;
  return {
    sleeps,
    set: (ms) => {
      now = ms;
    },
    now: () => now,
    tzOffsetMinutes: () => 300,
    sleep: (ms) => {
      if (!gated) return Promise.resolve();
      return new Promise<void>((resolve) => {
        sleeps.push({ ms, release: resolve });
      });
    },
  };
}

function gate(): { readonly wait: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

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

/** One Reminder in the `loadState()` wire format. */
function wire(id: string, number: CanonicalNumber, dueAt: number, slot = 1): Record<string, unknown> {
  return {
    id,
    number,
    slot,
    dueAt,
    text: 'take medicine',
    language: 'en',
    createdAt: T0 - 60 * MINUTE,
    handedAt: null,
  };
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
  readonly clock: TestClock;
}

function start(mock: MockPorts, clock: TestClock = fakeClock()): Harness {
  const ui = createGatewayStore();
  const logs: string[] = [];
  loop = startGatewayLoop(mock.ports, clock, { ui, log: (line) => logs.push(line) });
  return { mock, ui, logs, clock };
}

/** A mock whose `loadState` returns these reminders on every call. */
function mockWith(reminders: readonly unknown[]): MockPorts {
  const mock = createMockPorts();
  mock.scripts.loadState.setDefault((today) => emptyState(today, reminders));
  return mock;
}

/** Started and idle: attached, the start-up reminders run done and waiting for input. */
async function startIdle(mock: MockPorts, clock?: TestClock): Promise<Harness> {
  const h = start(mock, clock);
  await waitFor(() => mock.callsTo('waitForInbound').length >= 1, 'idle wait');
  await turns();
  return h;
}

const changeTypes = (c: CallRecord): string[] =>
  (c.args[0] as readonly { type: string }[]).map((ch) => ch.type);
const commitsWith = (type: string) => (c: CallRecord): boolean =>
  c.method === 'commit' && changeTypes(c).includes(type);
const isSend = (sendId: string) => (c: CallRecord): boolean =>
  c.method === 'sendParts' && c.args[0] === sendId;
const isCall = (method: string, arg: unknown) => (c: CallRecord): boolean =>
  c.method === method && c.args[0] === arg;
const sendIds = (mock: MockPorts): unknown[] => mock.callsTo('sendParts').map((c) => c.args[0]);
const outcomes = (mock: MockPorts): string[] =>
  mock.callsTo('appendActivity').map((c) => (c.args[0] as { outcome: string }).outcome);
const rescheduleCount = (mock: MockPorts): number => mock.callsTo('reschedule').length;
const firstIndex = (mock: MockPorts, pred: (c: CallRecord) => boolean, from = 0): number =>
  mock.calls.findIndex((c, i) => i >= from && pred(c));
const lastIndex = (mock: MockPorts, pred: (c: CallRecord) => boolean): number => {
  for (let i = mock.calls.length - 1; i >= 0; i--) {
    const c = mock.calls[i];
    if (c !== undefined && pred(c)) return i;
  }
  return -1;
};

describe('start order (11.6)', () => {
  it('sends a due reminder at start, after reconcile and attachLoop, before the first take', async () => {
    const mock = mockWith([wire('r1', A, T0 - MINUTE)]);
    mock.addPendingStop(B, T0 - 1000);
    mock.pushInbound(inbound('m1', B, 'HELP', T0));
    const h = start(mock);
    await waitFor(() => mock.callsTo('completeInbound').length === 1, 'm1 completed');
    await waitFor(() => outcomes(mock).includes('reminder-sent'), 'reminder-sent');

    const at = (pred: (c: CallRecord) => boolean): number => firstIndex(mock, pred);
    const order = [
      at((c) => c.method === 'loadState'),
      at((c) => c.method === 'getExactAlarmAccess'),
      at((c) => c.method === 'takePendingStops'),
      at((c) => c.method === 'onRemindersDue'),
      at((c) => c.method === 'attachLoop'),
      at(commitsWith('reminder-handed')),
      at(isSend('reminder:r1')),
      at((c) => c.method === 'takeNextInbound'),
    ];
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((x, y) => x - y)).toEqual(order);

    expect(mock.callsTo('sendParts').filter(isSend('reminder:r1'))).toHaveLength(1);
    expect(mock.callsTo('sendParts').find(isSend('reminder:r1'))?.args[1]).toBe(A);
    expect(rescheduleCount(mock)).toBeGreaterThanOrEqual(1);
    expect(h.ui.getSnapshot().reminderCount).toBe(0);
  });
});

describe('onRemindersDue (11.4)', () => {
  it('wakes an idle loop and sends the reminder that became due', async () => {
    const mock = mockWith([wire('r1', A, T0 + MINUTE)]);
    const h = await startIdle(mock);
    expect(mock.callsTo('sendParts')).toHaveLength(0);
    const before = rescheduleCount(mock);

    // Time passing alone does not run reminders; the alarm does.
    h.clock.set(T0 + MINUTE + 1000);
    await turns();
    expect(mock.callsTo('sendParts')).toHaveLength(0);

    mock.emitRemindersDue();
    await waitFor(() => outcomes(mock).includes('reminder-sent'), 'reminder-sent');
    expect(sendIds(mock)).toEqual(['reminder:r1']);
    expect(mock.callsTo('sendParts')[0]?.args[1]).toBe(A);
    expect(rescheduleCount(mock)).toBe(before + 1);
    expect(h.ui.getSnapshot().reminderCount).toBe(0);
  });
});

describe('between Inbound_Messages (12.5)', () => {
  it('runs due reminders after the current message completes and before the next take', async () => {
    const mock = mockWith([wire('r1', A, T0 + MINUTE)]);
    const h = await startIdle(mock);
    const held = gate();
    mock.scripts.completeInbound.setDefault(() => held.wait);

    mock.pushInbound(inbound('m1', B, 'HELP', T0 + 1));
    await waitFor(() => mock.callsTo('completeInbound').length === 1, 'm1 held in completeInbound');
    h.clock.set(T0 + MINUTE + 1000);
    mock.emitRemindersDue();
    mock.pushInbound(inbound('m2', B, 'HELP', T0 + 2));
    await turns();
    expect(mock.calls.some(isSend('reminder:r1'))).toBe(false); // never during a message

    held.open();
    mock.scripts.completeInbound.setDefault(() => undefined);
    await waitFor(() => mock.callsTo('completeInbound').length === 2, 'm2 completed');

    const m1Done = firstIndex(mock, isCall('completeInbound', 'm1'));
    const reminderAt = firstIndex(mock, isSend('reminder:r1'));
    const nextTake = firstIndex(mock, (c) => c.method === 'takeNextInbound', m1Done);
    expect(reminderAt).toBeGreaterThan(m1Done);
    expect(nextTake).toBeGreaterThan(reminderAt);
    expect(firstIndex(mock, isCall('completeInbound', 'm2'))).toBeGreaterThan(reminderAt);
  });
});

describe('paused gateway (11.7)', () => {
  it('sends nothing and keeps every reminder while paused, then runs them on resume', async () => {
    const mock = mockWith([wire('r1', A, T0 + MINUTE), wire('r2', B, T0 + MINUTE)]);
    const h = await startIdle(mock);
    const commitsBefore = mock.callsTo('commit').length;

    mock.emitServiceStatus('paused');
    h.clock.set(T0 + 2 * MINUTE);
    mock.emitRemindersDue();
    await turns();
    expect(mock.callsTo('sendParts')).toHaveLength(0);
    expect(mock.callsTo('commit')).toHaveLength(commitsBefore);
    expect(mock.callsTo('appendActivity')).toHaveLength(0);
    expect(h.ui.getSnapshot().reminderCount).toBe(2);

    mock.emitServiceStatus('running');
    await waitFor(
      () => outcomes(mock).filter((o) => o === 'reminder-sent').length === 2,
      'both reminders sent',
    );
    expect(sendIds(mock)).toEqual(['reminder:r1', 'reminder:r2']);
    expect(h.ui.getSnapshot().reminderCount).toBe(0);
  });
});

describe('STOP during a reminder run (8.1, 8.4)', () => {
  it('commits stop-add and reminder-remove-all together and never sends that reminder', async () => {
    const mock = mockWith([wire('r1', A, T0 + MINUTE), wire('r2', B, T0 + MINUTE)]);
    const h = await startIdle(mock);
    const held = gate();
    mock.scripts.completeInbound.setDefault(() => held.wait);

    mock.pushInbound(inbound('m1', A, 'STOP', T0 + 1));
    await waitFor(() => mock.callsTo('completeInbound').length === 1, 'STOP held in completeInbound');
    h.clock.set(T0 + 2 * MINUTE);
    mock.emitRemindersDue();
    await turns();
    held.open();
    await waitFor(() => outcomes(mock).includes('reminder-sent'), 'B reminder sent');
    await turns();

    const stopCommits = mock.callsTo('commit').filter(commitsWith('stop-add'));
    expect(stopCommits).toHaveLength(1);
    expect(stopCommits[0]?.args[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'stop-add', number: A }),
        expect.objectContaining({ type: 'reminder-remove-all', number: A }),
      ]),
    );
    expect(mock.calls.some(isSend('reminder:r1'))).toBe(false);
    expect(mock.callsTo('sendParts').filter(isSend('reminder:r2')).map((c) => c.args[1])).toEqual([B]);
    expect(mock.callsTo('cancelPendingSends').map((c) => c.args[0])).toEqual([A]);
    expect(outcomes(mock)).toEqual(['stopped', 'reminder-sent']);
    expect(h.ui.getSnapshot().reminderCount).toBe(0);
  });
});

describe('Stop_List read failure at start (10.12)', () => {
  it('sends nothing and keeps the reminder until the Stop_List loads, then delivers it', async () => {
    const mock = createMockPorts();
    mock.scripts.loadState.alwaysReject('io error');
    const clock = fakeClock(true);
    const h = start(mock, clock);

    await waitFor(() => clock.sleeps.length === 1, 'first load retry sleep');
    expect(clock.sleeps[0]?.ms).toBe(LOAD_RETRY_MS);
    clock.sleeps[0]?.release();
    await waitFor(() => clock.sleeps.length === 2, 'second load retry sleep');
    expect(mock.callsTo('sendParts')).toHaveLength(0);
    expect(mock.callsTo('commit')).toHaveLength(0);
    expect(mock.callsTo('appendActivity')).toHaveLength(0);
    expect(mock.callsTo('reschedule')).toHaveLength(0);

    // Due while unreadable; the Late_Window is measured from the original Due_Time.
    clock.set(T0 + 30 * MINUTE);
    mock.scripts.loadState.setDefault((today) => emptyState(today, [wire('r1', A, T0)]));
    clock.sleeps[1]?.release();
    await waitFor(() => outcomes(mock).includes('reminder-sent'), 'reminder-sent');
    expect(sendIds(mock)).toEqual(['reminder:r1']);
    expect(h.ui.getSnapshot().banners).not.toContain('stop-list-unreadable');
  });
});

describe('unreadable Reminder_Store (11.15, 12.7)', () => {
  it('shows the banner, records processing-failed, arms the retry and keeps running', async () => {
    const mock = mockWith([{ broken: true }]);
    const h = await startIdle(mock);

    await waitFor(() => mock.callsTo('scheduleRetry').length === 1, 'retry alarm');
    expect(h.ui.getSnapshot().banners).toContain('reminders-unreadable');
    expect(h.ui.getSnapshot().reminderCount).toBeNull();
    expect(mock.callsTo('appendActivity').map((c) => c.args[0])).toEqual([
      expect.objectContaining({ who: '', outcome: 'reminders-failed' }),
    ]);
    expect(mock.callsTo('sendParts')).toHaveLength(0);
    expect(mock.callsTo('commit')).toHaveLength(0);

    // Other commands keep working.
    mock.pushInbound(inbound('m1', B, 'HELP', T0 + 1));
    await waitFor(() => mock.callsTo('completeInbound').length === 1, 'm1 completed');
    expect(sendIds(mock)).toEqual(['m1']);

    // The retry alarm fires and the store is still unreadable: one more retry.
    mock.emitRemindersDue();
    await waitFor(() => mock.callsTo('scheduleRetry').length === 2, 'second retry alarm');
    expect(outcomes(mock).filter((o) => o === 'reminders-failed')).toHaveLength(2);

    // Readable again: the reminder is delivered and the banner goes away.
    mock.scripts.loadState.setDefault((today) => emptyState(today, [wire('r1', A, T0)]));
    mock.emitRemindersDue();
    await waitFor(() => outcomes(mock).includes('reminder-sent'), 'reminder-sent');
    expect(sendIds(mock)).toEqual(['m1', 'reminder:r1']);
    expect(h.ui.getSnapshot().banners).not.toContain('reminders-unreadable');
    expect(h.ui.getSnapshot().reminderCount).toBe(0);
  });
});

describe('failed REMIND commit (12.11)', () => {
  it('replies with the Reminders_Unavailable_Text and adds no reminder', async () => {
    const mock = createMockPorts();
    const h = await startIdle(mock);
    const before = rescheduleCount(mock);
    mock.scripts.commit.reject('disk full');

    mock.pushInbound(inbound('m1', A, 'REMIND in 2 hours drink water', T0));
    await waitFor(() => mock.callsTo('sendParts').length === 1, 'reply sent');
    await waitFor(() => mock.callsTo('appendActivity').length === 1, 'activity');
    expect(mock.callsTo('sendParts')[0]?.args[2]).toEqual(splitSms(REMINDER_TEXTS.en.unavailable));
    expect(mock.callsTo('commit').filter(commitsWith('reminder-add'))).toHaveLength(1);
    expect(mock.callsTo('commit').at(-1)?.args[0]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'reminder-add' })]),
    );
    expect(h.ui.getSnapshot().reminderCount).toBe(0);
    expect(rescheduleCount(mock)).toBe(before);
    for (const line of h.logs) expect(line).not.toContain('drink water');
  });
});

describe('reschedule after reminder changes (11.3, 8.9)', () => {
  it('re-arms the alarm after REMIND, CANCEL and STOP, and not after HELP', async () => {
    const mock = createMockPorts();
    const h = await startIdle(mock);
    let expected = rescheduleCount(mock);
    let completed = 0;

    const send = async (id: string, body: string): Promise<void> => {
      mock.pushInbound(inbound(id, A, body, T0 + completed));
      completed++;
      await waitFor(() => mock.callsTo('completeInbound').length === completed, `${id} completed`);
    };
    const expectRescheduledAfter = async (changeType: string): Promise<void> => {
      expected++;
      await waitFor(() => rescheduleCount(mock) === expected, `reschedule after ${changeType}`);
      const commitAt = lastIndex(mock, commitsWith(changeType));
      expect(commitAt).toBeGreaterThanOrEqual(0);
      expect(lastIndex(mock, (c) => c.method === 'reschedule')).toBeGreaterThan(commitAt);
    };

    await send('m1', 'REMIND in 2 hours drink water');
    await expectRescheduledAfter('reminder-add');
    expect(h.ui.getSnapshot().reminderCount).toBe(1);

    await send('m2', 'HELP');
    await turns();
    expect(rescheduleCount(mock)).toBe(expected);

    await send('m3', 'CANCEL 1');
    await expectRescheduledAfter('reminder-remove');
    expect(h.ui.getSnapshot().reminderCount).toBe(0);

    await send('m4', 'REMIND in 3 hours call Ali');
    await expectRescheduledAfter('reminder-add');
    expect(h.ui.getSnapshot().reminderCount).toBe(1);

    await send('m5', 'STOP');
    await expectRescheduledAfter('reminder-remove-all');
    expect(h.ui.getSnapshot().reminderCount).toBe(0);
  });
});

describe('loop stop', () => {
  it('removes the onRemindersDue listener', async () => {
    const mock = createMockPorts();
    await startIdle(mock);
    expect(mock.remindersDueListenerCount()).toBe(1);

    await loop?.stop();
    loop = null;
    expect(mock.remindersDueListenerCount()).toBe(0);
  });
});
