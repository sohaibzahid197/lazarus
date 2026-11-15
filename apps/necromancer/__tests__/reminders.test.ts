// Reminders runner (sms-reminders task 18.8): run order, the hand-off marker commit
// before `sendParts`, failed marker and removal commits, a failed Activity_Log append,
// handed rows at load and the alarm call that ends every run.
// Requirements 10.11, 10.14, 10.15, 11.4, 11.14, 13.8, 14.7.
import {
  applyChanges,
  countersFor,
  type CanonicalNumber,
  type Reminder,
  type StateChange,
} from '@lazarus/brain';
import { createAiHolder } from '../src/gateway/ai';
import { createCommitQueue } from '../src/gateway/commitQueue';
import { startGatewayLoop, type GatewayLoop } from '../src/gateway/loop';
import { todayKey, type Clock, type LoopContext } from '../src/gateway/loopSupport';
import {
  REMINDER_SAVE_RETRIES,
  REMINDER_SAVE_RETRY_MS,
  reconcileReminders,
  reminderSendId,
  runDueReminders,
} from '../src/gateway/reminders';
import { createGatewayStore, type GatewayStore } from '../src/gateway/store';
import { createMockPorts, emptyState, type MockPorts } from './support/mockPorts';

const A = '+923001111111' as CanonicalNumber;
const B = '+923002222222' as CanonicalNumber;
const C = '+923003333333' as CanonicalNumber;
const T0 = Date.UTC(2026, 0, 15, 5, 0, 0); // 2026-01-15 10:00 in UTC+5
const TEXT = 'take medicine';

/** Fake clock: `now` can be moved, every sleep resolves at once and is recorded. */
function fakeClock(): Clock & { at: number; readonly sleeps: number[] } {
  const clock = {
    at: T0,
    sleeps: [] as number[],
    now: () => clock.at,
    tzOffsetMinutes: () => 300,
    sleep: (ms: number) => {
      clock.sleeps.push(ms);
      return Promise.resolve();
    },
  };
  return clock;
}

/** Wire-format reminder as `loadState()` returns it. */
function wire(
  id: string,
  number: CanonicalNumber,
  slot: number,
  dueAt: number,
  handedAt: number | null = null,
): Record<string, unknown> {
  return { id, number, slot, dueAt, text: TEXT, language: 'en', createdAt: T0 - 86_400_000, handedAt };
}

interface Harness {
  readonly mock: MockPorts;
  readonly ctx: LoopContext;
  readonly ui: GatewayStore;
  readonly clock: ReturnType<typeof fakeClock>;
  readonly logs: string[];
}

/** A LoopContext like `prepare()` builds, over a readable state holding `reminders`. */
function harness(reminders: readonly unknown[], mock: MockPorts = createMockPorts()): Harness {
  const clock = fakeClock();
  const ui = createGatewayStore();
  const logs: string[] = [];
  const log = (line: string): void => {
    logs.push(line);
  };
  const decoded = emptyState(todayKey(clock), reminders);
  if (decoded.status !== 'ok') throw new Error('fixture state must be readable');
  const commits = createCommitQueue({
    store: mock.ports.store,
    onStopListSaveFailed: () => ui.setBanner('stop-list-save-failed', true),
    sleep: (ms) => clock.sleep(ms),
    log,
  });
  const ctx: LoopContext = {
    ports: mock.ports,
    clock,
    log,
    ui,
    commits,
    ai: createAiHolder(mock.ports.keyStore, () => clock.now()),
    state: decoded.state,
    remindersDue: true,
  };
  return { mock, ctx, ui, clock, logs };
}

/** Yields full event-loop turns until `cond` holds. */
async function waitFor(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (cond()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Lets the un-awaited send and its finalization run to the end. */
async function finish(h: Harness): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await h.mock.settle();
    await h.ctx.commits.idle();
  }
}

function gate(): { readonly wait: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

const remindersOf = (ctx: LoopContext): readonly Reminder[] =>
  ctx.state.reminders.status === 'ok' ? ctx.state.reminders.reminders : [];
const handedToday = (ctx: LoopContext): number =>
  countersFor(ctx.state.counters, todayKey(ctx.clock)).handed;
const committed = (mock: MockPorts): (readonly StateChange[])[] =>
  mock.callsTo('commit').map((c) => c.args[0] as readonly StateChange[]);
const types = (changes: readonly StateChange[]): string[] => changes.map((c) => c.type);
const outcomes = (mock: MockPorts): string[] =>
  mock.callsTo('appendActivity').map((c) => (c.args[0] as { outcome: string }).outcome);
const sendIds = (mock: MockPorts): unknown[] => mock.callsTo('sendParts').map((c) => c.args[0]);

describe('run order (10.11, 11.4)', () => {
  let loop: GatewayLoop | null = null;
  afterEach(async () => {
    await loop?.stop();
    loop = null;
  });

  it('onRemindersDue passes due reminders in (dueAt, id) order and skips later ones', async () => {
    const mock = createMockPorts();
    const clock = fakeClock();
    const stored = [
      wire('r-b', B, 1, T0 + 2_000),
      wire('r-late', A, 2, T0 + 3_600_000),
      wire('r-a', A, 1, T0 + 2_000),
      wire('r-c', C, 1, T0 + 1_000),
    ];
    mock.scripts.loadState.setDefault((today) => emptyState(today, stored));
    loop = startGatewayLoop(mock.ports, clock, { ui: createGatewayStore(), log: () => undefined });
    await waitFor(() => mock.callsTo('waitForInbound').length > 0, 'loop idle');
    expect(mock.callsTo('sendParts')).toHaveLength(0); // nothing due at loop start

    clock.at = T0 + 5_000;
    mock.emitRemindersDue();
    await waitFor(() => mock.callsTo('appendActivity').length === 3, 'three outcomes');

    expect(sendIds(mock)).toEqual(['reminder:r-c', 'reminder:r-a', 'reminder:r-b']);
    expect(mock.callsTo('sendParts').map((c) => c.args[1])).toEqual([C, A, B]);
    expect(outcomes(mock)).toEqual(['reminder-sent', 'reminder-sent', 'reminder-sent']);
  });

  it('each decision counts the parts handed for the reminders decided before it', async () => {
    const h = harness([wire('r-2', B, 1, T0 - 1_000), wire('r-1', A, 1, T0 - 2_000)]);
    h.ctx.state = { ...h.ctx.state, settings: { ...h.ctx.state.settings, dailySendCap: 1 } };
    await runDueReminders(h.ctx);
    await finish(h);

    expect(sendIds(h.mock)).toEqual([reminderSendId({ id: 'r-1' as Reminder['id'] })]);
    expect([...outcomes(h.mock)].sort()).toEqual(['reminder-capped', 'reminder-sent']);
    expect(remindersOf(h.ctx)).toHaveLength(0);
  });
});

describe('hand-off marker (10.8, 11.14)', () => {
  it('commits reminder-handed and the counters reserve before sendParts', async () => {
    const h = harness([wire('r-1', A, 1, T0 - 1_000)]);
    await runDueReminders(h.ctx);
    await finish(h);

    expect(h.mock.names(['commit', 'sendParts', 'appendActivity'])).toEqual([
      'commit',
      'sendParts',
      'commit',
      'appendActivity',
    ]);
    const [handOff, removal] = committed(h.mock);
    expect(types(handOff ?? [])).toEqual(['reminder-handed', 'counters']);
    expect(types(removal ?? [])).toContain('reminder-remove');
    expect(h.mock.callsTo('sendParts')[0]?.args.slice(0, 2)).toEqual(['reminder:r-1', A]);
    expect(outcomes(h.mock)).toEqual(['reminder-sent']);
    expect(remindersOf(h.ctx)).toHaveLength(0);
    expect(h.ui.getSnapshot().reminderCount).toBe(0);
  });

  it('a failed marker commit sends nothing, restores memory and keeps the reminder due', async () => {
    const h = harness([wire('r-1', A, 1, T0 - 1_000)]);
    const handedBefore = handedToday(h.ctx);
    h.mock.scripts.commit.reject('disk full');
    await runDueReminders(h.ctx);
    await finish(h);

    expect(h.mock.callsTo('sendParts')).toHaveLength(0);
    expect(h.mock.callsTo('appendActivity')).toHaveLength(0);
    expect(remindersOf(h.ctx).map((r) => [r.id, r.handedAt])).toEqual([['r-1', null]]);
    expect(handedToday(h.ctx)).toBe(handedBefore);
    expect(h.ctx.remindersDue).toBe(true);

    await runDueReminders(h.ctx); // the next run retries it
    await finish(h);
    expect(sendIds(h.mock)).toEqual(['reminder:r-1']);
    expect(outcomes(h.mock)).toEqual(['reminder-sent']);
  });

  it('re-checks the Stop_List right before sending', async () => {
    const h = harness([wire('r-1', A, 1, T0 - 1_000)]);
    const g = gate();
    let commits = 0;
    h.mock.scripts.commit.setDefault(() => (commits++ === 0 ? g.wait : undefined));
    const run = runDueReminders(h.ctx);
    await waitFor(() => commits === 1, 'hand-off commit started');
    h.ctx.state = applyChanges(h.ctx.state, [{ type: 'stop-add', number: A }]); // STOP meanwhile
    g.open();
    await run;
    await finish(h);

    expect(h.mock.callsTo('sendParts')).toHaveLength(0);
    expect(outcomes(h.mock)).toEqual(['reminder-stopped']);
    expect(remindersOf(h.ctx)).toHaveLength(0);
  });
});

describe('removal commit failure (10.14)', () => {
  it(`retries ${REMINDER_SAVE_RETRIES} times at 1 s, then raises reminders-save-failed`, async () => {
    const h = harness([wire('r-1', A, 1, T0 - 1_000)]);
    h.mock.scripts.commit.resolve(undefined).reject('disk full', 1 + REMINDER_SAVE_RETRIES);
    await runDueReminders(h.ctx);
    await waitFor(() => h.mock.callsTo('appendActivity').length === 1, 'outcome recorded');
    await finish(h);

    expect(h.mock.callsTo('commit')).toHaveLength(2 + REMINDER_SAVE_RETRIES);
    expect(h.clock.sleeps).toEqual(Array.from({ length: REMINDER_SAVE_RETRIES }, () => REMINDER_SAVE_RETRY_MS));
    expect(h.ui.getSnapshot().banners).toContain('reminders-save-failed');
    expect(outcomes(h.mock)).toEqual(['reminder-sent']);
    expect(remindersOf(h.ctx)).toHaveLength(0); // removal kept in memory

    await runDueReminders(h.ctx);
    await finish(h);
    expect(h.mock.callsTo('sendParts')).toHaveLength(1); // never handed again
  });

  it('a removal saved on the last retry raises no banner', async () => {
    const h = harness([wire('r-1', A, 1, T0 - 1_000)]);
    h.mock.scripts.commit.resolve(undefined).reject('disk full', REMINDER_SAVE_RETRIES);
    await runDueReminders(h.ctx);
    await waitFor(() => h.mock.callsTo('appendActivity').length === 1, 'outcome recorded');
    await finish(h);

    expect(h.mock.callsTo('commit')).toHaveLength(2 + REMINDER_SAVE_RETRIES);
    expect(h.ui.getSnapshot().banners).not.toContain('reminders-save-failed');
  });
});

describe('Activity_Log append failure (13.8)', () => {
  it('keeps the outcome, removes the reminder and sends nothing more', async () => {
    const h = harness([wire('r-1', A, 1, T0 - 1_000)]);
    h.mock.scripts.appendActivity.reject('disk full');
    await runDueReminders(h.ctx);
    await finish(h);

    expect(h.mock.callsTo('appendActivity')).toHaveLength(1);
    expect(h.ui.getSnapshot().activity.map((e) => e.outcome)).toEqual(['reminder-sent']);
    expect(types(committed(h.mock)[1] ?? [])).toContain('reminder-remove');
    expect(remindersOf(h.ctx)).toHaveLength(0);

    await runDueReminders(h.ctx);
    await finish(h);
    expect(h.mock.callsTo('sendParts')).toHaveLength(1);
    expect(h.mock.callsTo('appendActivity')).toHaveLength(1);
  });
});

describe('handed row at load (10.15, 11.14)', () => {
  it('records reminder-failed once and never resends it', async () => {
    const h = harness([wire('r-1', A, 1, T0 - 60_000, T0 - 59_000)]);
    await reconcileReminders(h.ctx);

    expect(committed(h.mock)).toEqual([[{ type: 'reminder-remove', id: 'r-1' }]]);
    expect(outcomes(h.mock)).toEqual(['reminder-failed']);
    expect(remindersOf(h.ctx)).toHaveLength(0);

    await runDueReminders(h.ctx);
    await finish(h);
    expect(h.mock.callsTo('sendParts')).toHaveLength(0);
    expect(outcomes(h.mock)).toEqual(['reminder-failed']);
  });
});

describe('alarm after every run (11.4, 11.15)', () => {
  it('reschedules after an empty run, a delivery and a failed marker commit', async () => {
    const empty = harness([wire('r-1', A, 1, T0 + 60_000)]);
    await runDueReminders(empty.ctx);
    expect(empty.mock.names(['sendParts', 'reschedule'])).toEqual(['reschedule']);

    const delivered = harness([wire('r-1', A, 1, T0 - 1_000)]);
    await runDueReminders(delivered.ctx);
    expect(delivered.mock.names(['commit', 'reschedule']).slice(0, 2)).toEqual(['commit', 'reschedule']);

    const failed = harness([wire('r-1', A, 1, T0 - 1_000)]);
    failed.mock.scripts.commit.reject('disk full');
    await runDueReminders(failed.ctx);
    expect(failed.mock.callsTo('reschedule')).toHaveLength(1);
  });

  it('a failing reschedule is logged and does not reject the run', async () => {
    const h = harness([]);
    h.mock.scripts.reschedule.reject('alarm failed');
    await expect(runDueReminders(h.ctx)).resolves.toBeUndefined();
    expect(h.logs).toContain('reminders: reschedule failed');
  });

  it('an unreadable store sends nothing, adds one processing-failed entry and arms the retry', async () => {
    const h = harness([]);
    h.ctx.state = { ...h.ctx.state, reminders: { status: 'unreadable' } };
    await runDueReminders(h.ctx);
    await finish(h);

    expect(h.mock.callsTo('sendParts')).toHaveLength(0);
    expect(h.mock.callsTo('commit')).toHaveLength(0);
    expect(outcomes(h.mock)).toEqual(['reminders-failed']);
    expect(h.mock.callsTo('scheduleRetry')).toHaveLength(1);
    expect(h.mock.callsTo('reschedule')).toHaveLength(0);
    expect(h.ui.getSnapshot().banners).toContain('reminders-unreadable');
  });
});
