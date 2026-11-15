// Component tests for Reminders in the Ouija_Simulator
// (Requirements 13.2, 13.3, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12).
// Renders the real OuijaSimulator with the default browser env: fetch is
// stubbed globally and timers are fake, so Due_Times and retries run instantly.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryOutcome } from '@lazarus/brain';
import { emptySnapshot } from '../protocol/emptySnapshot';
import type { SessionSnapshot, SnapshotReminder } from '../protocol/snapshot.types';
import type { ResponsePart, SimulatorRequest, SimulatorResponse } from '../protocol/wire.types';
import { OuijaSimulator } from './OuijaSimulator';
import { REMINDERS_TAB_NOTE, SESSION_RESET_TEXT, activeRemindersText } from './texts';

const T0 = 1_767_225_600_000;
/** The server clock runs this far ahead of the browser clock (clock offset). */
const OFFSET = 5_000;
const DUE_IN = 60_000;
const RETRY_MS = 60_000;
const TIMEOUT_MS = 30_000;
const DRIP_MS = 700;

interface FetchStub {
  readonly calls: SimulatorRequest[];
  /** Fake-clock time of each fetch call. */
  readonly sentAt: number[];
  /** Answers the oldest waiting request. */
  respond(body: unknown, status?: number): void;
  /** Rejects the oldest waiting request like a network failure. */
  failNetwork(): void;
}

/** Global fetch stub whose requests stay open until the test answers them; aborts reject. */
function stubFetch(): FetchStub {
  const calls: SimulatorRequest[] = [];
  const sentAt: number[] = [];
  const waiting: { resolve: (r: Response) => void; reject: (e: unknown) => void }[] = [];
  vi.stubGlobal('fetch', (_input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push(JSON.parse(typeof init?.body === 'string' ? init.body : '') as SimulatorRequest);
    sentAt.push(Date.now());
    return new Promise<Response>((resolve, reject) => {
      const entry = { resolve, reject };
      waiting.push(entry);
      init?.signal?.addEventListener('abort', () => {
        waiting.splice(waiting.indexOf(entry), 1);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  });
  return {
    calls,
    sentAt,
    respond(body, status = 200) {
      waiting.shift()?.resolve(new Response(JSON.stringify(body), { status }));
    },
    failNetwork() {
      waiting.shift()?.reject(new TypeError('Failed to fetch'));
    },
  };
}

function part(text: string, limit: number): ResponsePart {
  return { text, units: text.length, limit };
}

function messageReply(snapshot: SessionSnapshot, serverTime: number, text = 'Reminder set.'): SimulatorResponse {
  return {
    kind: 'message',
    parts: [part(text, 160)],
    encoding: 'GSM-7',
    command: 'REMIND',
    language: 'en',
    outcome: 'replied',
    deliveryOutcome: null,
    snapshot,
    repliesLeft: 4,
    serverTime,
  };
}

function deliverReply(
  snapshot: SessionSnapshot,
  serverTime: number,
  texts: readonly string[],
  deliveryOutcome: DeliveryOutcome | null,
): SimulatorResponse {
  const limit = texts.length > 1 ? 153 : 160;
  return {
    kind: 'deliver',
    parts: texts.map((t) => part(t, limit)),
    encoding: 'GSM-7',
    command: null,
    language: 'en',
    outcome: null,
    deliveryOutcome,
    snapshot,
    repliesLeft: 4,
    serverTime,
  };
}

/** Lets the fetch promise chain and 0 ms timers settle without moving the clock. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/** Moves the fake browser clock to `t` (running every timer on the way), then settles. */
async function advanceTo(t: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(t - Date.now());
  });
  await flush();
}

function phone(): HTMLElement {
  return screen.getByRole('region', { name: 'Phone' });
}

interface ShownBubble {
  readonly kind: string | undefined;
  readonly label: string | null;
  readonly text: string | null;
  readonly badge: string | null;
}

function bubbles(): ShownBubble[] {
  const list = screen.getByRole('list', { name: 'Messages' });
  return Array.from(list.querySelectorAll<HTMLElement>('.bubble')).map((b) => ({
    kind: b.dataset.bubbleKind,
    label: b.querySelector('.bubble__label')?.textContent ?? null,
    text: b.querySelector('.bubble__text')?.textContent ?? null,
    badge: b.querySelector('.bubble__badge')?.textContent ?? null,
  }));
}

function polite(): string[] {
  return Array.from(screen.getByTestId('announcer-polite').children).map((p) => p.textContent);
}

function activeShown(count: number): boolean {
  return screen.queryByText(activeRemindersText(count)) !== null;
}

/** Switches to Keyboard_Input once, types `body` and presses Enter in the Compose_Field. */
async function sendByKeyboard(user: UserEvent, body: string): Promise<void> {
  if (screen.queryByRole('button', { name: /^Input:\s*Keypad$/ }) !== null) {
    await user.click(screen.getByRole('button', { name: /^Input:\s*Keypad$/ }));
  }
  await user.type(screen.getByRole('textbox', { name: 'Message' }), body);
  await user.keyboard('{Enter}');
  await flush();
}

interface Scheduled {
  readonly reminder: SnapshotReminder;
  readonly snapshot: SessionSnapshot;
  /** Browser time at which the corrected clock reaches the Due_Time. */
  readonly dueBrowser: number;
}

/** Sends REMIND and answers it with a snapshot holding one Reminder due DUE_IN after the Server_Time. */
async function scheduleReminder(user: UserEvent, f: FetchStub): Promise<Scheduled> {
  await sendByKeyboard(user, 'REMIND in 1 minute drink water');
  const browserNow = Date.now();
  const serverTime = browserNow + OFFSET;
  const reminder: SnapshotReminder = {
    id: 'r:mabc-a',
    slot: 1,
    dueAt: serverTime + DUE_IN,
    text: 'drink water',
    language: 'en',
    createdAt: serverTime,
  };
  const snapshot: SessionSnapshot = { ...emptySnapshot(T0), receiveTimes: [serverTime], reminders: [reminder] };
  f.respond(messageReply(snapshot, serverTime));
  await flush();
  return { reminder, snapshot, dueBrowser: browserNow + DUE_IN };
}

describe('Ouija_Simulator reminders', () => {
  let user: UserEvent;
  let f: FetchStub;

  beforeEach(() => {
    // Only the clock and timeouts: faking queueMicrotask or MessageChannel stalls React and user-event.
    vi.useFakeTimers({ now: T0, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    f = stubFetch();
    // Testing Library's async wrapper only advances fake timers when it sees a global `jest`.
    vi.stubGlobal('jest', {
      advanceTimersByTime: (ms: number) => {
        vi.advanceTimersByTime(ms);
      },
    });
    user = userEvent.setup({
      advanceTimers: (ms) => {
        vi.advanceTimersByTime(ms);
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the Active_Reminders count and the tab-only note', async () => {
    render(<OuijaSimulator />);
    expect(activeShown(0)).toBe(true);
    expect(screen.getByText(REMINDERS_TAB_NOTE)).toBeTruthy();
    await scheduleReminder(user, f);
    expect(activeShown(1)).toBe(true);
    expect(screen.getByText(REMINDERS_TAB_NOTE)).toBeTruthy();
  });

  it('sends one deliver at the Due_Time on the corrected clock and labels the first part Reminder', async () => {
    render(<OuijaSimulator />);
    const { reminder, snapshot, dueBrowser } = await scheduleReminder(user, f);
    expect(f.calls).toHaveLength(1);

    await advanceTo(dueBrowser - 1);
    expect(f.calls).toHaveLength(1);
    await advanceTo(dueBrowser);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]).toEqual({ type: 'deliver', reminderId: reminder.id, snapshot });
    expect(phone().dataset.state).toBe('SENDING');

    const after: SessionSnapshot = { ...snapshot, reminders: [] };
    const texts = ['(1/2) Reminder: drink water', '(2/2) and rest a little'] as const;
    f.respond(deliverReply(after, reminder.dueAt, texts, 'reminder-sent'));
    await flush();
    expect(activeShown(0)).toBe(true);
    expect(bubbles().slice(2)).toEqual([
      { kind: 'reminder-part', label: 'Reminder', text: texts[0], badge: 'Part 1 of 2 · GSM-7 · 27/153' },
    ]);

    await advanceTo(Date.now() + DRIP_MS);
    expect(bubbles().slice(2)).toEqual([
      { kind: 'reminder-part', label: 'Reminder', text: texts[0], badge: 'Part 1 of 2 · GSM-7 · 27/153' },
      { kind: 'reminder-part', label: null, text: texts[1], badge: 'Part 2 of 2 · GSM-7 · 23/153' },
    ]);
    expect(polite()).toContain(`Reminder. ${texts[0]}. Part 1 of 2 · GSM-7 · 27/153`);
    expect(phone().dataset.state).toBe('ALIVE');

    // The Reminder is gone, so no further check is sent.
    await advanceTo(Date.now() + 10 * RETRY_MS);
    expect(f.calls).toHaveLength(2);
  });

  it('rechecks after a wait at the Due_Time, with a 1-second floor, then shows the 0-part note', async () => {
    render(<OuijaSimulator />);
    const { reminder, snapshot, dueBrowser } = await scheduleReminder(user, f);
    await advanceTo(dueBrowser);
    expect(f.calls).toHaveLength(2);
    const shown = bubbles().length;

    // Server clock 3 s behind the Due_Time: recheck 3 s later.
    f.respond(deliverReply(snapshot, reminder.dueAt - 3_000, [], null));
    await flush();
    expect(bubbles()).toHaveLength(shown);
    expect(activeShown(1)).toBe(true);
    await advanceTo(dueBrowser + 2_999);
    expect(f.calls).toHaveLength(2);
    await advanceTo(dueBrowser + 3_000);
    expect(f.calls).toHaveLength(3);
    expect(f.calls[2]).toEqual({ type: 'deliver', reminderId: reminder.id, snapshot });

    // Server only 200 ms behind: the 1-second floor applies.
    const second = Date.now();
    f.respond(deliverReply(snapshot, reminder.dueAt - 200, [], null));
    await flush();
    await advanceTo(second + 999);
    expect(f.calls).toHaveLength(3);
    await advanceTo(second + 1_000);
    expect(f.calls).toHaveLength(4);

    f.respond(deliverReply({ ...snapshot, reminders: [] }, reminder.dueAt + 3_700_000, [], 'reminder-expired'));
    await flush();
    expect(bubbles().slice(shown)).toEqual([
      { kind: 'note', label: null, text: 'Reminder not sent: it was more than 1 hour late.', badge: null },
    ]);
    expect(bubbles().some((b) => b.label === 'Reminder')).toBe(false);
    expect(activeShown(0)).toBe(true);
  });

  it('shows the STOP note for reminder-stopped and nothing for an unknown Reminder_Id', async () => {
    render(<OuijaSimulator />);
    const { reminder, snapshot, dueBrowser } = await scheduleReminder(user, f);
    const second: SnapshotReminder = { ...reminder, id: 'r:mabd-b', slot: 2, dueAt: reminder.dueAt + 1 };
    // A LIST reply hands back two Reminders due 1 ms apart.
    await sendByKeyboard(user, 'LIST');
    const both: SessionSnapshot = { ...snapshot, reminders: [second, reminder] };
    f.respond(messageReply(both, Date.now() + OFFSET, '1. drink water'));
    // The LIST part drips 700 ms after the REMIND part.
    await advanceTo(Date.now() + DRIP_MS);
    expect(activeShown(2)).toBe(true);
    const shown = bubbles().length;

    // Both due together: sent one at a time in Due_Time order.
    await advanceTo(dueBrowser + 1);
    expect(f.calls).toHaveLength(3);
    expect(f.calls[2]).toMatchObject({ type: 'deliver', reminderId: reminder.id });
    f.respond(deliverReply({ ...both, reminders: [second] }, reminder.dueAt + 1, [], 'reminder-stopped'));
    await flush();
    expect(f.calls).toHaveLength(4);
    expect(f.calls[3]).toEqual({ type: 'deliver', reminderId: second.id, snapshot: { ...both, reminders: [second] } });

    // Not found on the server: 0 parts, no Delivery_Outcome, no bubble.
    f.respond(deliverReply({ ...both, reminders: [] }, reminder.dueAt + 2, [], null));
    await flush();
    expect(bubbles().slice(shown)).toEqual([
      { kind: 'note', label: null, text: 'Reminder not sent: STOP is on.', badge: null },
    ]);
    expect(activeShown(0)).toBe(true);
    await advanceTo(Date.now() + 10 * RETRY_MS);
    expect(f.calls).toHaveLength(4);
  });

  it('retries the same deliver 60 s after a 429, a network failure or a 30-second timeout, with no bubble', async () => {
    render(<OuijaSimulator />);
    const { reminder, snapshot, dueBrowser } = await scheduleReminder(user, f);
    await advanceTo(dueBrowser);
    expect(f.calls).toHaveLength(2);
    const shown = bubbles().length;
    const deliver = { type: 'deliver', reminderId: reminder.id, snapshot };

    f.respond({ error: 'rate-limited' }, 429);
    await flush();
    expect(bubbles()).toHaveLength(shown);
    await advanceTo(dueBrowser + RETRY_MS - 1);
    expect(f.calls).toHaveLength(2);
    await advanceTo(dueBrowser + RETRY_MS);
    expect(f.calls).toHaveLength(3);
    expect(f.calls[2]).toEqual(deliver);

    f.failNetwork();
    await flush();
    expect(bubbles()).toHaveLength(shown);
    expect(phone().dataset.state).toBe('ALIVE');
    await advanceTo(dueBrowser + 2 * RETRY_MS - 1);
    expect(f.calls).toHaveLength(3);
    await advanceTo(dueBrowser + 2 * RETRY_MS);
    expect(f.calls).toHaveLength(4);
    expect(f.calls[3]).toEqual(deliver);

    // No answer: aborted after 30 s, retried 60 s after that.
    const timedOut = dueBrowser + 2 * RETRY_MS + TIMEOUT_MS;
    await advanceTo(timedOut + RETRY_MS - 1);
    expect(f.calls).toHaveLength(4);
    expect(bubbles()).toHaveLength(shown);
    await advanceTo(timedOut + RETRY_MS);
    expect(f.calls).toHaveLength(5);
    expect(f.calls[4]).toEqual(deliver);

    f.respond(deliverReply({ ...snapshot, reminders: [] }, Date.now() + OFFSET, ['Reminder: drink water'], 'reminder-sent'));
    await flush();
    expect(bubbles().slice(shown)).toEqual([
      { kind: 'reminder-part', label: 'Reminder', text: 'Reminder: drink water', badge: 'Part 1 of 1 · GSM-7 · 21/160' },
    ]);
  });

  it('holds a due deliver back while a message waits, and queues a message behind a deliver', async () => {
    render(<OuijaSimulator />);
    const { reminder, dueBrowser } = await scheduleReminder(user, f);

    await advanceTo(dueBrowser - 10_000);
    await sendByKeyboard(user, 'HELP');
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]).toMatchObject({ type: 'message', body: 'HELP' });
    await advanceTo(dueBrowser + 5_000);
    expect(f.calls).toHaveLength(2);

    // The deliver goes out with the snapshot from the message response.
    const now = Date.now();
    const afterHelp: SessionSnapshot = {
      ...emptySnapshot(T0),
      receiveTimes: [reminder.createdAt, now + OFFSET],
      reminders: [reminder],
    };
    f.respond(messageReply(afterHelp, now + OFFSET, 'Lazarus: text any question.'));
    await flush();
    expect(f.calls).toHaveLength(3);
    expect(f.calls[2]).toEqual({ type: 'deliver', reminderId: reminder.id, snapshot: afterHelp });

    // A message sent while the deliver is in flight shows at once and waits for its turn.
    await advanceTo(Date.now() + DRIP_MS);
    await sendByKeyboard(user, 'LIST');
    expect(bubbles().at(-1)).toEqual({ kind: 'outgoing', label: null, text: 'LIST', badge: null });
    expect(f.calls).toHaveLength(3);

    const afterDeliver: SessionSnapshot = { ...afterHelp, reminders: [] };
    f.respond(deliverReply(afterDeliver, Date.now() + OFFSET, ['Reminder: drink water'], 'reminder-sent'));
    await flush();
    expect(f.calls).toHaveLength(4);
    expect(f.calls[3]).toEqual({ type: 'message', body: 'LIST', snapshot: afterDeliver });
  });

  it('a 400 on deliver resets the session and cancels every Reminder check', async () => {
    render(<OuijaSimulator />);
    const { dueBrowser } = await scheduleReminder(user, f);
    await advanceTo(dueBrowser);
    expect(f.calls).toHaveLength(2);

    f.respond({ error: 'invalid-reminder-id' }, 400);
    await flush();
    expect(bubbles()).toEqual([{ kind: 'note', label: null, text: SESSION_RESET_TEXT, badge: null }]);
    expect(activeShown(0)).toBe(true);
    expect(phone().dataset.state).toBe('ALIVE');

    await advanceTo(Date.now() + 10 * RETRY_MS);
    expect(f.calls).toHaveLength(2);
  });
});
