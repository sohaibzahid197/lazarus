// Reminder privacy (sms-reminders task 18.10): drives the real gateway loop through
// REMIND, LIST, CANCEL, a due reminder delivery, STOP, an unreadable Reminder_Store and
// failed commits, then checks that no Reminder_Text (and so no Reminder_Delivery_Text
// or LIST reply text) and no run of 4 or more digits of the Canonical_Number reaches
// the loop log, console output, the UI store, the Activity_Log or the notification.
// `sendParts` (the SMS itself) and `commit` (the stored reminder) carry the text by
// design and are not checked.
// Requirements 13.2, 13.3, 13.4, 14.7.
import { maskNumber, type CanonicalNumber } from '@lazarus/brain';
import { startGatewayLoop, type Clock, type GatewayLoop } from '../src/gateway/loop';
import { createGatewayStore, type GatewayStore } from '../src/gateway/store';
import {
  createMockPorts,
  emptyState,
  inbound,
  type MockPorts,
} from './support/mockPorts';

/** Distinctive Reminder_Text: a word that appears nowhere else in the app. */
const MARKER = 'zxqvplumbago';
const N = '+923458675309' as CanonicalNumber;
const T0 = Date.UTC(2026, 0, 15, 5, 0, 0);
const MINUTE = 60_000;

/** Every run of 4 or more consecutive digits of the number. */
function digitRuns(number: string): string[] {
  const digits = number.replace(/\D/g, '');
  const runs: string[] = [];
  for (let len = 4; len <= digits.length; len++) {
    for (let i = 0; i + len <= digits.length; i++) runs.push(digits.slice(i, i + len));
  }
  return runs;
}
const RUNS = digitRuns(N);

function fakeClock(): Clock & { set(ms: number): void } {
  let now = T0;
  return {
    set: (ms) => {
      now = ms;
    },
    now: () => now,
    tzOffsetMinutes: () => 300,
    sleep: () => Promise.resolve(),
  };
}

async function waitFor(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (cond()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function turns(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
let consoleOut: string[] = [];
let loop: GatewayLoop | null = null;

beforeEach(() => {
  consoleOut = [];
  for (const m of CONSOLE_METHODS) {
    jest.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      consoleOut.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ''}` : String(a))).join(' '));
    });
  }
});

afterEach(async () => {
  await loop?.stop();
  loop = null;
  jest.restoreAllMocks();
});

interface Harness {
  readonly mock: MockPorts;
  readonly ui: GatewayStore;
  readonly logs: string[];
  readonly clock: ReturnType<typeof fakeClock>;
  /** Every UI snapshot seen, as JSON without the receive-time fields. */
  readonly snapshots: string[];
}

/** JSON without `receivedAt` (13.4 allows digits only in the receive time). */
const withoutTimes = (value: unknown): string =>
  JSON.stringify(value, (key, v: unknown) => (key === 'receivedAt' ? undefined : v));

async function startIdle(mock: MockPorts): Promise<Harness> {
  const ui = createGatewayStore();
  const logs: string[] = [];
  const snapshots: string[] = [];
  ui.subscribe(() => snapshots.push(withoutTimes(ui.getSnapshot())));
  const clock = fakeClock();
  loop = startGatewayLoop(mock.ports, clock, { ui, log: (line) => logs.push(line) });
  await waitFor(() => mock.callsTo('waitForInbound').length >= 1, 'idle wait');
  await turns();
  return { mock, ui, logs, clock, snapshots };
}

/** Pushes one message from N and waits until it is completed. */
async function send(h: Harness, id: string, body: string, at: number): Promise<void> {
  const done = h.mock.callsTo('completeInbound').length + 1;
  h.mock.pushInbound(inbound(id, N, body, at));
  await waitFor(() => h.mock.callsTo('completeInbound').length === done, `${id} completed`);
}

const outcomes = (mock: MockPorts): string[] =>
  mock.callsTo('appendActivity').map((c) => (c.args[0] as { outcome: string }).outcome);

/** The surfaces Requirement 13.2 and 13.3 cover, each as named text. */
function surfaces(h: Harness): [string, string][] {
  const out: [string, string][] = [];
  h.logs.forEach((line, i) => out.push([`log[${i}]`, line]));
  consoleOut.forEach((line, i) => out.push([`console[${i}]`, line]));
  h.snapshots.forEach((s, i) => out.push([`ui snapshot[${i}]`, s]));
  out.push(['ui final snapshot', withoutTimes(h.ui.getSnapshot())]);
  h.mock.callsTo('appendActivity').forEach((c, i) => out.push([`appendActivity[${i}]`, withoutTimes(c.args)]));
  h.mock.callsTo('applyPendingStop').forEach((c, i) =>
    out.push([`applyPendingStop entry[${i}]`, withoutTimes(c.args[2])]),
  );
  h.mock.callsTo('updateNotification').forEach((c, i) =>
    out.push([`updateNotification[${i}]`, JSON.stringify(c.args)]),
  );
  return out;
}

function expectNoLeak(h: Harness): void {
  const leaks: string[] = [];
  for (const [where, text] of surfaces(h)) {
    if (text.toLowerCase().includes(MARKER)) leaks.push(`${where}: Reminder_Text in ${text}`);
    const run = RUNS.find((r) => text.includes(r));
    if (run !== undefined) leaks.push(`${where}: digits ${run} of the number in ${text}`);
  }
  expect(leaks).toEqual([]);
  // Every Activity_Entry names the number only by its mask.
  for (const c of h.mock.callsTo('appendActivity')) {
    const who = (c.args[0] as { who: string }).who;
    expect(who === '' || who === maskNumber(N)).toBe(true);
  }
}

describe('reminder privacy (13.2, 13.3, 13.4)', () => {
  it('REMIND, LIST, CANCEL, a due delivery and STOP leak no text and no number', async () => {
    const h = await startIdle(createMockPorts());
    const { mock } = h;

    await send(h, 'm1', `REMIND in 1 minute ${MARKER} one`, T0);
    await send(h, 'm2', `REMIND in 2 hours ${MARKER} two`, T0 + 1);
    await send(h, 'm3', `REMIND in 3 hours ${MARKER} three`, T0 + 2);
    expect(h.ui.getSnapshot().reminderCount).toBe(3);
    await send(h, 'm4', 'LIST', T0 + 3);
    await send(h, 'm5', 'CANCEL 2', T0 + 4);
    expect(h.ui.getSnapshot().reminderCount).toBe(2);

    h.clock.set(T0 + 2 * MINUTE);
    mock.emitRemindersDue();
    await waitFor(() => outcomes(mock).includes('reminder-sent'), 'reminder-sent');
    expect(h.ui.getSnapshot().reminderCount).toBe(1);

    await send(h, 'm6', 'STOP', T0 + 3 * MINUTE);
    await turns();
    expect(h.ui.getSnapshot().reminderCount).toBe(0);

    // The marker did reach the SMS surfaces, so its absence elsewhere is meaningful.
    const sent = mock.callsTo('sendParts');
    const sentText = (id: string): string =>
      JSON.stringify(sent.find((c) => c.args[0] === id)?.args[2] ?? null);
    expect(sentText('m4')).toContain(MARKER); // LIST reply
    expect(JSON.stringify(sent.filter((c) => String(c.args[0]).startsWith('reminder:')))).toContain(MARKER);
    expect(sent.every((c) => c.args[1] === N)).toBe(true);
    expect(outcomes(mock)).toContain('stopped');
    expect(outcomes(mock)).toHaveLength(7); // 6 messages and 1 Delivery_Outcome
    expect(mock.callsTo('updateNotification').length).toBeGreaterThan(0);
    expect(RUNS).toEqual(expect.arrayContaining(['9234', '8675', '5309', '923458675309']));

    expectNoLeak(h);
  });

  it('failed commits and a failed Activity_Log append leak no text and no number', async () => {
    const h = await startIdle(createMockPorts());
    const { mock } = h;

    // A failed REMIND commit: the Reminders_Unavailable_Text goes out, nothing is kept.
    mock.scripts.commit.reject('disk full');
    await send(h, 'm1', `REMIND in 1 minute ${MARKER} lost`, T0);
    expect(h.ui.getSnapshot().reminderCount).toBe(0);

    await send(h, 'm2', `REMIND in 1 minute ${MARKER} kept`, T0 + 1);
    await send(h, 'm3', `REMIND in 2 hours ${MARKER} later`, T0 + 2);
    expect(h.ui.getSnapshot().reminderCount).toBe(2);

    // A failed CANCEL commit.
    mock.scripts.commit.reject('disk full');
    await send(h, 'm4', 'CANCEL 2', T0 + 3);

    // A delivery whose hand-off commit fails once and whose Activity_Log append fails.
    mock.scripts.commit.reject('disk full');
    mock.scripts.appendActivity.setDefault(() => Promise.reject(new Error('activity io error')));
    // The marker is not saved, so nothing is sent and the reminder stays due;
    // the next alarm delivers it.
    h.clock.set(T0 + 2 * MINUTE);
    mock.emitRemindersDue();
    await waitFor(() => h.logs.some((l) => l.includes('hand-off marker not saved')), 'marker failure');
    await turns();
    expect(mock.callsTo('sendParts').some((c) => String(c.args[0]).startsWith('reminder:'))).toBe(false);
    mock.emitRemindersDue();
    await waitFor(
      () => mock.callsTo('sendParts').some((c) => String(c.args[0]).startsWith('reminder:')),
      'reminder delivery sent',
    );
    await turns();
    await waitFor(() => h.logs.some((l) => l.includes('activity append failed')), 'append failure logged');
    mock.scripts.appendActivity.setDefault(() => undefined);
    expect(h.logs.some((l) => l.includes('reminder commit failed'))).toBe(true);

    expectNoLeak(h);
  });

  it('an unreadable Reminder_Store holding the text and number leaks neither', async () => {
    const mock = createMockPorts();
    const broken = { id: 'r1', number: N, slot: 'x', dueAt: 'soon', text: MARKER };
    mock.scripts.loadState.setDefault((today) => emptyState(today, [broken]));
    const h = await startIdle(mock);

    await waitFor(() => mock.callsTo('scheduleRetry').length === 1, 'retry alarm');
    expect(h.ui.getSnapshot().banners).toContain('reminders-unreadable');
    await send(h, 'm1', `REMIND in 1 minute ${MARKER}`, T0 + 1);
    await send(h, 'm2', 'LIST', T0 + 2);
    mock.emitRemindersDue();
    await waitFor(() => mock.callsTo('scheduleRetry').length === 2, 'second retry alarm');

    expectNoLeak(h);
  });
});
