// Component tests for the send flow of the Ouija_Simulator (task 15.9).
// Fake timers drive the clock and the drip; a stubbed fetch releases each
// Simulator_Response when the test says so. Bodies pass isSimulatorResponse.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySnapshot } from '../protocol/emptySnapshot';
import { isSimulatorResponse } from '../protocol/response.check';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorRequest, SimulatorResponse } from '../protocol/wire.types';
import { DRIP_INTERVAL_MS } from '../session/useOuijaSession';
import { OuijaSimulator } from './OuijaSimulator';
import { STATE_LABELS, STOP_BANNER_TEXT } from './texts';

const T0 = 1_767_225_600_000;
const PARTS = ['(1/3) first part', '(2/3) second part', '(3/3) third part'] as const;

interface StubFetch {
  readonly calls: SimulatorRequest[];
  resolve(body: SimulatorResponse): void;
}

/** fetch stub: records each request body and holds its response until `resolve`. */
function stubFetch(): StubFetch {
  const calls: SimulatorRequest[] = [];
  const waiting: ((res: Response) => void)[] = [];
  const fn = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push(JSON.parse(typeof init?.body === 'string' ? init.body : '') as SimulatorRequest);
    return new Promise<Response>((resolve, reject) => {
      waiting.push(resolve);
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  };
  vi.stubGlobal('fetch', vi.fn(fn));
  return {
    calls,
    resolve(body) {
      expect(isSimulatorResponse(body)).toBe(true);
      waiting.shift()?.(new Response(JSON.stringify(body), { status: 200 }));
    },
  };
}

function helpReply(texts: readonly string[], serverTime: number): SimulatorResponse {
  const multi = texts.length > 1;
  return {
    kind: 'message',
    parts: texts.map((text) => ({ text, units: text.length, limit: multi ? 153 : 160 })),
    encoding: 'GSM-7',
    command: 'HELP',
    language: 'en',
    outcome: 'replied',
    deliveryOutcome: null,
    snapshot: emptySnapshot(serverTime),
    repliesLeft: 4,
    serverTime,
  };
}

function stopReply(serverTime: number): SimulatorResponse {
  const snapshot: SessionSnapshot = { ...emptySnapshot(serverTime), stopped: true };
  return {
    kind: 'message',
    parts: [],
    encoding: 'GSM-7',
    command: 'STOP',
    language: 'en',
    outcome: 'stopped',
    deliveryOutcome: null,
    snapshot,
    repliesLeft: 4,
    serverTime,
  };
}

/** Lets the response promise chain settle and runs the 0 ms drip timer it schedules. */
async function settle(): Promise<void> {
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

function incomingTexts(): string[] {
  return Array.from(document.querySelectorAll('[data-bubble-kind="part"] .bubble__text')).map(
    (el) => el.textContent,
  );
}

function sendButton(): HTMLButtonElement {
  const el = screen.getByRole('button', { name: 'Send' });
  if (!(el instanceof HTMLButtonElement)) throw new Error('Send is not a button');
  return el;
}

function stateLabel(): string | null {
  return document.querySelector('.heartbeat__label')?.textContent ?? null;
}

function countIn(region: HTMLElement, text: string): number {
  return within(region)
    .queryAllByText((_content, el) => el?.tagName === 'P' && el.textContent === text)
    .length;
}

async function typeMessage(user: UserEvent, text: string): Promise<void> {
  await user.type(screen.getByRole('textbox', { name: 'Message' }), text);
}

describe('Ouija_Simulator send flow', () => {
  let scrollSpy: ReturnType<typeof vi.fn>;
  let user: UserEvent;

  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollSpy,
      configurable: true,
      writable: true,
    });
    // Testing Library's asyncWrapper waits on a 0 ms setTimeout and only
    // advances it when it sees a `jest` global, so Vitest fake timers need this shim.
    vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
    user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends one request, drips badged parts 700 ms apart and announces each once', async () => {
    const f = stubFetch();
    render(<OuijaSimulator />);
    expect(stateLabel()).toBe(STATE_LABELS.ALIVE);
    expect(sendButton().disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: /^Input:/ }));
    await typeMessage(user, 'HELP');
    expect(sendButton().disabled).toBe(false);
    await user.click(sendButton());
    await settle();

    // One request with the Message_Body and the current snapshot (6.1).
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ type: 'message', body: 'HELP', snapshot: { stopped: false } });
    const outgoing = document.querySelectorAll('[data-bubble-kind="outgoing"] .bubble__text');
    expect(Array.from(outgoing).map((el) => el.textContent)).toEqual(['HELP']);
    const field = screen.getByRole('textbox', { name: 'Message' });
    expect(field instanceof HTMLTextAreaElement && field.value).toBe('');
    expect(stateLabel()).toBe(STATE_LABELS.SENDING);

    // While waiting: Send disabled, Enter ignored, Compose_Field editable (6.3).
    await typeMessage(user, 'more');
    expect(sendButton().disabled).toBe(true);
    await user.keyboard('{Enter}');
    await settle();
    expect(f.calls).toHaveLength(1);

    const scrollsBefore = scrollSpy.mock.calls.length;
    f.resolve(helpReply(PARTS, T0 + 1_000));
    await settle();

    // Part 1 at once, then 700 ms apart (11.1); still SENDING and disabled (11.5).
    expect(incomingTexts()).toEqual([PARTS[0]]);
    expect(stateLabel()).toBe(STATE_LABELS.SENDING);
    expect(sendButton().disabled).toBe(true);
    await advance(DRIP_INTERVAL_MS - 1);
    expect(incomingTexts()).toHaveLength(1);
    await advance(1);
    expect(incomingTexts()).toEqual([PARTS[0], PARTS[1]]);
    expect(sendButton().disabled).toBe(true);
    await advance(DRIP_INTERVAL_MS);
    expect(incomingTexts()).toEqual([...PARTS]);

    // Badges on every part, the Language label on the first only (2.7, 11.2).
    const bubbles = Array.from(document.querySelectorAll('[data-bubble-kind="part"]'));
    expect(bubbles.map((b) => b.querySelector('.bubble__badge')?.textContent)).toEqual(
      PARTS.map((t, i) => `Part ${String(i + 1)} of 3 · GSM-7 · ${String(t.length)}/153`),
    );
    expect(bubbles.map((b) => b.querySelector('.bubble__label')?.textContent ?? null)).toEqual([
      'English',
      null,
      null,
    ]);

    // Done: ALIVE again, Send enabled with the waiting text, Replies_Left updated (11.5, 6.4).
    expect(stateLabel()).toBe(STATE_LABELS.ALIVE);
    expect(sendButton().disabled).toBe(false);
    expect(document.querySelector('.replies-left__count')?.textContent).toBe('Replies left: 4 of 5');

    // Newest bubble scrolled into view for each added part (2.5).
    expect(scrollSpy.mock.calls.length - scrollsBefore).toBeGreaterThanOrEqual(3);

    // Each part announced once, politely, with its Part_Badge text (16.4).
    const polite = screen.getByTestId('announcer-polite');
    for (const [i, text] of PARTS.entries()) {
      const announced = `${text}. Part ${String(i + 1)} of 3 · GSM-7 · ${String(text.length)}/153`;
      expect(countIn(polite, announced)).toBe(1);
    }
    expect(countIn(screen.getByTestId('announcer-assertive'), PARTS[0])).toBe(0);
  });

  it('shows the STOP banner and SLEEPING after a STOP reply', async () => {
    const f = stubFetch();
    render(<OuijaSimulator />);
    expect(screen.queryByText(STOP_BANNER_TEXT)).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Input:/ }));
    await typeMessage(user, 'STOP');
    await user.keyboard('{Enter}');
    await settle();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ type: 'message', body: 'STOP' });

    f.resolve(stopReply(T0 + 1_000));
    await settle();

    // 0 parts: one note, no part bubble or badge (11.6); banner and SLEEPING (12.5, 14.6).
    expect(incomingTexts()).toEqual([]);
    expect(document.querySelectorAll('.bubble__badge')).toHaveLength(0);
    const notes = document.querySelectorAll('[data-bubble-kind="note"] .bubble__text');
    expect(Array.from(notes).map((el) => el.textContent)).toEqual(['No reply.']);
    expect(screen.getByText(STOP_BANNER_TEXT)).toBeTruthy();
    expect(stateLabel()).toBe(STATE_LABELS.SLEEPING);
  });
});
