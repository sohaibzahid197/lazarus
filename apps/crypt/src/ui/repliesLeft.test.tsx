// Component tests for the Replies_Left_Indicator and its hint in the Ouija_Simulator
// (Requirements 19.7, 19.8, 19.9, 19.10, 19.11).
// Renders the real OuijaSimulator with the default browser env: fetch is
// stubbed globally and timers are fake, so the 700 ms drip runs instantly.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, GATEWAY_TEXTS, type Outcome } from '@lazarus/brain';
import { emptySnapshot } from '../protocol/emptySnapshot';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorRequest, SimulatorResponse } from '../protocol/wire.types';
import { OuijaSimulator } from './OuijaSimulator';
import { NEW_SESSION_TEXT, NO_REPLIES_LEFT_HINT, REPLY_LIMIT_NOTE } from './texts';

const T0 = 1_767_225_600_000;
const HELP_TEXT = 'Lazarus: text any question.';

interface FetchStub {
  readonly calls: SimulatorRequest[];
  /** Answers the oldest waiting request. */
  respond(body: unknown, status?: number): void;
}

/** Global fetch stub whose requests stay open until the test answers them; aborts reject. */
function stubFetch(): FetchStub {
  const calls: SimulatorRequest[] = [];
  const waiting: { resolve: (r: Response) => void }[] = [];
  vi.stubGlobal('fetch', (_input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push(JSON.parse(typeof init?.body === 'string' ? init.body : '') as SimulatorRequest);
    return new Promise<Response>((resolve, reject) => {
      const entry = { resolve };
      waiting.push(entry);
      init?.signal?.addEventListener('abort', () => {
        waiting.splice(waiting.indexOf(entry), 1);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  });
  return {
    calls,
    respond(body, status = 200) {
      waiting.shift()?.resolve(new Response(JSON.stringify(body), { status }));
    },
  };
}

function reply(
  text: string,
  repliesLeft: number,
  outcome: Outcome = 'replied',
  snapshot: SessionSnapshot = emptySnapshot(T0),
): SimulatorResponse {
  return {
    kind: 'message',
    parts: [{ text, units: text.length, limit: 160 }],
    encoding: 'GSM-7',
    command: 'HELP',
    language: 'en',
    outcome,
    deliveryOutcome: null,
    snapshot,
    repliesLeft,
    serverTime: T0,
  };
}

/** Lets the fetch promise chain settle without running the 700 ms drip. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function phone(): HTMLElement {
  return screen.getByRole('region', { name: 'Phone' });
}

function indicator(): string | null {
  return phone().querySelector('.replies-left__count')?.textContent ?? null;
}

function hint(): string | null {
  return phone().querySelector('.replies-left__hint')?.textContent ?? null;
}

/** Polite announcements about Replies_Left, in order. */
function repliesAnnouncements(): string[] {
  return Array.from(screen.getByTestId('announcer-polite').children)
    .map((p) => p.textContent)
    .filter((t) => t.startsWith('Replies left:'));
}

function bubbleTexts(): string[] {
  const list = screen.getByRole('list', { name: 'Messages' });
  return Array.from(list.querySelectorAll('.bubble__text')).map((p) => p.textContent);
}

/** Switches to Keyboard_Input once, types `body` and presses Enter. */
async function sendByKeyboard(user: UserEvent, body: string): Promise<void> {
  if (screen.queryByRole('button', { name: /^Input:\s*Keypad$/ }) !== null) {
    await user.click(screen.getByRole('button', { name: /^Input:\s*Keypad$/ }));
  }
  await user.type(screen.getByRole('textbox', { name: 'Message' }), body);
  await user.keyboard('{Enter}');
  await flush();
}

/** Sends HELP, answers it with `body` and lets the whole drip finish. */
async function exchange(user: UserEvent, f: FetchStub, body: SimulatorResponse): Promise<void> {
  await sendByKeyboard(user, 'HELP');
  f.respond(body);
  await flush();
  await advance(1_600);
}

describe('Replies_Left_Indicator and hint', () => {
  let user: UserEvent;
  let f: FetchStub;

  beforeEach(() => {
    vi.useFakeTimers({ now: T0, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    f = stubFetch();
    // Testing Library waits on a 0 ms setTimeout and advances it only when it sees `jest`.
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

  it('starts at 5 of 5 with no hint and no announcement', () => {
    render(<OuijaSimulator />);
    expect(DEFAULT_SETTINGS.perNumberLimit).toBe(5);
    expect(indicator()).toBe('Replies left: 5 of 5');
    expect(hint()).toBeNull();
    expect(repliesAnnouncements()).toEqual([]);
  });

  it('follows each response, shows the hint only at 0 and announces each change once', async () => {
    render(<OuijaSimulator />);
    for (const n of [4, 3, 2, 1, 0]) {
      await sendByKeyboard(user, 'HELP');
      f.respond(reply(HELP_TEXT, n));
      await flush();
      // Indicator and hint change together, as soon as the response is accepted.
      expect(indicator()).toBe(`Replies left: ${String(n)} of 5`);
      expect(hint()).toBe(n === 0 ? NO_REPLIES_LEFT_HINT : null);
      await advance(1_600);
    }
    expect(repliesAnnouncements()).toEqual([
      'Replies left: 4 of 5',
      'Replies left: 3 of 5',
      'Replies left: 2 of 5',
      'Replies left: 1 of 5',
      `Replies left: 0 of 5. ${NO_REPLIES_LEFT_HINT}`,
    ]);
  });

  it('makes no announcement when a response leaves Replies_Left unchanged', async () => {
    render(<OuijaSimulator />);
    await exchange(user, f, reply(HELP_TEXT, 4));
    await exchange(user, f, reply(HELP_TEXT, 4));
    expect(f.calls).toHaveLength(2);
    expect(indicator()).toBe('Replies left: 4 of 5');
    expect(repliesAnnouncements()).toEqual(['Replies left: 4 of 5']);
  });

  it('a 1-part rate-limited reply shows the Slow_Down_Text, then the reply-limit note 700 to 800 ms later', async () => {
    render(<OuijaSimulator />);
    const slowDown = GATEWAY_TEXTS.en.slowDown;
    await sendByKeyboard(user, 'HELP');
    f.respond(reply(slowDown, 0, 'rate-limited'));
    await flush();

    expect(bubbleTexts()).toEqual(['HELP', slowDown]);
    expect(indicator()).toBe('Replies left: 0 of 5');
    expect(hint()).toBe(NO_REPLIES_LEFT_HINT);

    await advance(699);
    expect(bubbleTexts()).not.toContain(REPLY_LIMIT_NOTE);
    await advance(101);
    expect(bubbleTexts()).toEqual(['HELP', slowDown, REPLY_LIMIT_NOTE]);
    expect(repliesAnnouncements()).toEqual([`Replies left: 0 of 5. ${NO_REPLIES_LEFT_HINT}`]);
  });

  it('New session resets the indicator to 5 of 5, hides the hint and announces the change', async () => {
    render(<OuijaSimulator />);
    await exchange(user, f, reply(HELP_TEXT, 0));
    expect(hint()).toBe(NO_REPLIES_LEFT_HINT);

    await user.click(screen.getByRole('button', { name: 'New session' }));
    await flush();

    expect(f.calls).toHaveLength(1);
    expect(indicator()).toBe('Replies left: 5 of 5');
    expect(hint()).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Messages' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      NEW_SESSION_TEXT,
    ]);
    expect(repliesAnnouncements()).toEqual([`Replies left: 0 of 5. ${NO_REPLIES_LEFT_HINT}`, 'Replies left: 5 of 5']);
  });
});
