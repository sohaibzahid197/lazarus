// Component test for the New_Session_Button (Requirements 18.11, 19.1–19.5).
// Renders the real OuijaSimulator with the default browser env: fetch is
// stubbed globally and timers are fake. The stub keeps an aborted request
// answerable, so the test can deliver a late response after the reset.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySnapshot } from '../protocol/emptySnapshot';
import { isSimulatorResponse } from '../protocol/response.check';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorRequest, SimulatorResponse } from '../protocol/wire.types';
import { OuijaSimulator } from './OuijaSimulator';
import { NEW_SESSION_TEXT, STATE_LABELS, STOP_BANNER_TEXT } from './texts';

const T0 = 1_767_225_600_000;
const DUE_AT = T0 + 60_000;

interface FetchStub {
  readonly calls: SimulatorRequest[];
  readonly signals: AbortSignal[];
  /** Answers the oldest unanswered request, even one that was aborted. */
  respond(body: SimulatorResponse): void;
}

function stubFetch(): FetchStub {
  const calls: SimulatorRequest[] = [];
  const signals: AbortSignal[] = [];
  const waiting: ((r: Response) => void)[] = [];
  vi.stubGlobal('fetch', (_input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push(JSON.parse(typeof init?.body === 'string' ? init.body : '') as SimulatorRequest);
    if (init?.signal) signals.push(init.signal);
    // Ignores abort on purpose: models a server reply that arrives after the reset.
    return new Promise<Response>((resolve) => {
      waiting.push(resolve);
    });
  });
  return {
    calls,
    signals,
    respond(body) {
      expect(isSimulatorResponse(body)).toBe(true);
      waiting.shift()?.(new Response(JSON.stringify(body), { status: 200 }));
    },
  };
}

/** STOP on with 1 Reminder: only reachable with an edited snapshot, as 18.11 sets up. */
function stoppedSnapshot(): SessionSnapshot {
  return {
    ...emptySnapshot(T0),
    stopped: true,
    reminders: [
      { id: 'r:mab-a', slot: 1, dueAt: DUE_AT, text: 'drink water', language: 'en', createdAt: T0 },
    ],
  };
}

function reply(
  command: 'STOP' | 'HELP',
  snapshot: SessionSnapshot,
  repliesLeft: number,
): SimulatorResponse {
  const text = 'Lazarus: text any question.';
  return {
    kind: 'message',
    parts: command === 'STOP' ? [] : [{ text, units: text.length, limit: 160 }],
    encoding: 'GSM-7',
    command,
    language: 'en',
    outcome: command === 'STOP' ? 'stopped' : 'replied',
    deliveryOutcome: null,
    snapshot,
    repliesLeft,
    serverTime: T0,
  };
}

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

function phone(): HTMLElement {
  return screen.getByRole('region', { name: 'Phone' });
}

function thread(): string[] {
  const list = screen.getByRole('list', { name: 'Messages' });
  return within(list)
    .queryAllByRole('listitem')
    .map((li) => li.textContent);
}

function repliesLeftShown(): string | null {
  return phone().querySelector('.replies-left__count')?.textContent ?? null;
}

function banner(): Element | null {
  return phone().querySelector('.stop-banner');
}

describe('Ouija_Simulator New session', () => {
  let user: UserEvent;
  let f: FetchStub;

  beforeEach(() => {
    vi.useFakeTimers({ now: T0, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    f = stubFetch();
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

  it('resets locally with STOP on, a Reminder scheduled and a message waiting', async () => {
    render(<OuijaSimulator />);
    await user.click(screen.getByRole('button', { name: /^Input:\s*Keypad$/ }));
    const field = screen.getByRole('textbox', { name: 'Message' });

    // STOP on with 1 Reminder scheduled.
    await user.type(field, 'STOP');
    await user.keyboard('{Enter}');
    await settle();
    f.respond(reply('STOP', stoppedSnapshot(), 4));
    await settle();
    expect(banner()?.textContent).toBe(STOP_BANNER_TEXT);
    expect(repliesLeftShown()).toBe('Replies left: 4 of 5');
    expect(screen.getByText('Active reminders: 1')).toBeTruthy();

    // A `message` request waits; the visitor keeps typing a draft.
    await user.type(field, 'HELP');
    await user.keyboard('{Enter}');
    await settle();
    expect(f.calls).toHaveLength(2);
    expect(phone().dataset.state).toBe('SENDING');
    await user.type(field, 'draft');

    await user.click(screen.getByRole('button', { name: 'New session' }));

    // Nothing sent; the waiting request is aborted (19.3, 19.4).
    expect(f.calls).toHaveLength(2);
    expect(f.signals[1]?.aborted).toBe(true);
    // Only the note, no banner, Replies_Left back to 5 of 5, ALIVE (19.2, 19.5).
    expect(thread()).toEqual([NEW_SESSION_TEXT]);
    expect(banner()).toBeNull();
    expect(repliesLeftShown()).toBe('Replies left: 5 of 5');
    expect(phone().dataset.state).toBe('ALIVE');
    expect(phone().querySelector('.heartbeat__label')?.textContent).toBe(STATE_LABELS.ALIVE);
    expect(screen.getByText('Active reminders: 0')).toBeTruthy();
    // Compose cleared, Keypad_Input in Lower_Case Letter_Mode (19.2 f, g).
    expect(screen.getByRole('button', { name: /^Input:\s*Keypad$/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toBe('');
    expect(phone().querySelector('.phone__mode')?.textContent).toContain('abc');

    // The old Reminder's Due_Time passes: no `deliver` request (19.2 c).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DUE_AT + 60_000 - Date.now());
    });
    expect(f.calls).toHaveLength(2);

    // The late response to the aborted request changes nothing (19.4).
    f.respond(reply('HELP', stoppedSnapshot(), 2));
    await settle();
    expect(thread()).toEqual([NEW_SESSION_TEXT]);
    expect(banner()).toBeNull();
    expect(repliesLeftShown()).toBe('Replies left: 5 of 5');
    expect(screen.getByText('Active reminders: 0')).toBeTruthy();
    expect(f.calls).toHaveLength(2);
  });
});
