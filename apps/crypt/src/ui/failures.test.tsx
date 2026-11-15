// Component tests for failed requests in the Ouija_Simulator
// (Requirements 6.5, 6.6, 6.7, 10.6, 14.5, 16.11, 19.12).
// Renders the real OuijaSimulator with the default browser env: fetch is
// stubbed globally and timers are fake, so the 30-second timeout runs instantly.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GATEWAY_TEXTS } from '@lazarus/brain';
import { emptySnapshot } from '../protocol/emptySnapshot';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorRequest, SimulatorResponse } from '../protocol/wire.types';
import { OuijaSimulator } from './OuijaSimulator';
import { CONNECTION_ERROR_TEXT, SESSION_RESET_TEXT, STATE_LABELS } from './texts';

const T0 = 1_767_225_600_000;
const TIMEOUT_MS = 30_000;

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
        // An aborted request leaves the queue, so `respond` answers the live one.
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

function helpReply(snapshot: SessionSnapshot, repliesLeft: number): SimulatorResponse {
  const text = 'Lazarus: text any question.';
  return {
    kind: 'message',
    parts: [{ text, units: text.length, limit: 160 }],
    encoding: 'GSM-7',
    command: 'HELP',
    language: 'en',
    outcome: 'replied',
    deliveryOutcome: null,
    snapshot,
    repliesLeft,
    serverTime: T0,
  };
}

/** Lets the fetch promise chain settle, then runs the drip timer (items are 700 ms apart). */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
}

function repliesLeftShown(): string | null {
  return phone().querySelector('.replies-left__count')?.textContent ?? null;
}

function phone(): HTMLElement {
  return screen.getByRole('region', { name: 'Phone' });
}

function thread(): string[] {
  const list = screen.getByRole('list', { name: 'Messages' });
  return within(list)
    .queryAllByRole('listitem')
    .map((li) => li.textContent);
}

function assertive(): string[] {
  return Array.from(screen.getByTestId('announcer-assertive').children).map((p) => p.textContent);
}

function heartbeatLabel(): string | null {
  return phone().querySelector('.heartbeat__label')?.textContent ?? null;
}

/** Switches to Keyboard_Input once, types `body` and presses Enter in the Compose_Field. */
async function sendByKeyboard(user: UserEvent, body: string): Promise<HTMLElement> {
  if (screen.queryByRole('button', { name: /^Input:\s*Keypad$/ }) !== null) {
    await user.click(screen.getByRole('button', { name: /^Input:\s*Keypad$/ }));
  }
  const field = screen.getByRole('textbox', { name: 'Message' });
  await user.type(field, body);
  await user.keyboard('{Enter}');
  await settle();
  return field;
}

describe('Ouija_Simulator failures', () => {
  let user: UserEvent;
  let f: FetchStub;

  beforeEach(() => {
    // Only the clock and timeouts: faking queueMicrotask or MessageChannel stalls React and user-event.
    vi.useFakeTimers({ now: T0, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    f = stubFetch();
    // Testing Library's async wrapper waits on a 0 ms setTimeout and only
    // advances it when it sees a global `jest`; without this shim every
    // user-event call hangs under Vitest fake timers.
    vi.stubGlobal('jest', {
      advanceTimersByTime: (ms: number) => {
        vi.advanceTimersByTime(ms);
      },
    });
    // user-event waits on timers between actions; let it drive the fake clock.
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

  it('a 30-second timeout shows the connection note assertively and the error state until the next send', async () => {
    render(<OuijaSimulator />);
    const field = await sendByKeyboard(user, 'HELP');
    expect(f.calls).toHaveLength(1);
    expect(phone().dataset.state).toBe('SENDING');

    await act(async () => {
      await vi.advanceTimersByTimeAsync((f.sentAt[0] ?? 0) + TIMEOUT_MS - 1 - Date.now());
    });
    expect(phone().dataset.state).toBe('SENDING');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await settle();

    expect(thread()).toEqual(['HELP', CONNECTION_ERROR_TEXT]);
    expect(assertive()).toEqual([CONNECTION_ERROR_TEXT]);
    expect(phone().dataset.state).toBe('ERROR');
    expect(heartbeatLabel()).toBe(STATE_LABELS.ERROR);
    expect(phone().querySelector('.phone__error')?.textContent).toBe(CONNECTION_ERROR_TEXT);
    expect(document.activeElement).toBe(field);
    expect((field as HTMLTextAreaElement).value).toBe('');

    // No automatic retry; the error state lasts until the visitor sends again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(f.calls).toHaveLength(1);
    expect(phone().dataset.state).toBe('ERROR');

    await sendByKeyboard(user, 'HELP');
    expect(f.calls).toHaveLength(2);
    expect(phone().dataset.state).toBe('SENDING');
    f.respond(helpReply(emptySnapshot(T0), 4));
    await settle();
    expect(phone().dataset.state).toBe('ALIVE');
    expect(phone().querySelector('.phone__error')).toBeNull();
  });

  it('a network failure gives the same note and keeps the previous Session_Snapshot', async () => {
    render(<OuijaSimulator />);
    await sendByKeyboard(user, 'HELP');
    const snap: SessionSnapshot = { ...emptySnapshot(T0), receiveTimes: [T0] };
    f.respond(helpReply(snap, 4));
    await settle();

    await sendByKeyboard(user, 'HELP again');
    f.failNetwork();
    await settle();
    expect(thread().at(-1)).toBe(CONNECTION_ERROR_TEXT);
    expect(assertive()).toEqual([CONNECTION_ERROR_TEXT]);
    expect(phone().dataset.state).toBe('ERROR');
    expect(repliesLeftShown()).toBe('Replies left: 4 of 5');

    await sendByKeyboard(user, 'third');
    expect(f.calls[2]?.snapshot).toEqual(snap);
  });

  it('a 500 response shows the connection note in the assertive region', async () => {
    render(<OuijaSimulator />);
    await sendByKeyboard(user, 'HELP');
    f.respond({ error: 'internal' }, 500);
    await settle();
    expect(thread()).toEqual(['HELP', CONNECTION_ERROR_TEXT]);
    expect(assertive()).toEqual([CONNECTION_ERROR_TEXT]);
    expect(phone().dataset.state).toBe('ERROR');
    expect(heartbeatLabel()).toBe(STATE_LABELS.ERROR);
  });

  it('a 200 with an invalid body is treated as a failed request', async () => {
    render(<OuijaSimulator />);
    await sendByKeyboard(user, 'HELP');
    f.respond({ kind: 'message', parts: 'nope' });
    await settle();
    expect(thread()).toEqual(['HELP', CONNECTION_ERROR_TEXT]);
    expect(assertive()).toEqual([CONNECTION_ERROR_TEXT]);
    expect(phone().dataset.state).toBe('ERROR');
    expect(repliesLeftShown()).toBe('Replies left: 5 of 5');
  });

  it('a 429 shows the Slow_Down_Text assertively and keeps the snapshot and Replies_Left', async () => {
    render(<OuijaSimulator />);
    await sendByKeyboard(user, 'HELP');
    const snap: SessionSnapshot = { ...emptySnapshot(T0), receiveTimes: [T0, T0] };
    f.respond(helpReply(snap, 3));
    await settle();
    expect(repliesLeftShown()).toBe('Replies left: 3 of 5');

    const field = await sendByKeyboard(user, 'HELP');
    const slowDown = GATEWAY_TEXTS.en.slowDown;
    f.respond({ error: 'rate-limited', slowDown }, 429);
    await settle();

    expect(thread().slice(-2)).toEqual(['HELP', slowDown]);
    expect(assertive()).toEqual([slowDown]);
    expect(repliesLeftShown()).toBe('Replies left: 3 of 5');
    // Not the error state: the request was answered, just limited (10.6).
    expect(phone().dataset.state).toBe('ALIVE');
    expect(document.activeElement).toBe(field);
    // No hint that New session lifts the per-IP limit (19.12).
    expect(screen.queryByText(/New session/, { selector: '.bubble__text' })).toBeNull();

    await sendByKeyboard(user, 'HELP');
    expect(f.calls).toHaveLength(3);
    expect(f.calls[2]?.snapshot).toEqual(snap);
  });

  it('a 400 invalid-snapshot resets the session with the reset note', async () => {
    render(<OuijaSimulator />);
    await sendByKeyboard(user, 'HELP');
    f.respond({ error: 'invalid-snapshot' }, 400);
    await settle();
    expect(thread()).toEqual([SESSION_RESET_TEXT]);
    expect(phone().dataset.state).toBe('ALIVE');
    expect(repliesLeftShown()).toBe('Replies left: 5 of 5');
    expect(assertive()).toEqual([]);
  });
});
