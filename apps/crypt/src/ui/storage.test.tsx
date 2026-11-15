// Component test: the Ouija_Simulator keeps the Simulator_Session only in page memory (Requirement 8.6).
// Renders the real OuijaSimulator with the default browser env and spies on every browser
// storage API while a full session runs: a message, a reply that sets a Reminder, the
// Reminder delivery, and New session.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { emptySnapshot } from '../protocol/emptySnapshot';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorRequest, SimulatorResponse } from '../protocol/wire.types';
import { OuijaSimulator } from './OuijaSimulator';
import { NEW_SESSION_TEXT } from './texts';

const T0 = 1_767_225_600_000;
const DUE = T0 + 60_000;

interface FetchStub {
  readonly calls: SimulatorRequest[];
  /** Answers the oldest waiting request. */
  respond(body: unknown, status?: number): void;
}

/** Global fetch stub whose requests stay open until the test answers them; aborts reject. */
function stubFetch(): FetchStub {
  const calls: SimulatorRequest[] = [];
  const waiting: { resolve: (r: Response) => void; reject: (e: unknown) => void }[] = [];
  vi.stubGlobal('fetch', (_input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push(JSON.parse(typeof init?.body === 'string' ? init.body : '') as SimulatorRequest);
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
    respond(body, status = 200) {
      waiting.shift()?.resolve(new Response(JSON.stringify(body), { status }));
    },
  };
}

function part(text: string): { text: string; units: number; limit: number } {
  return { text, units: text.length, limit: 160 };
}

function remindReply(snapshot: SessionSnapshot): SimulatorResponse {
  return {
    kind: 'message',
    parts: [part('Reminder set for 1 minute: drink water')],
    encoding: 'GSM-7',
    command: 'REMIND',
    language: 'en',
    outcome: 'replied',
    deliveryOutcome: null,
    snapshot,
    repliesLeft: 4,
    serverTime: T0,
  };
}

function deliverReply(snapshot: SessionSnapshot): SimulatorResponse {
  return {
    kind: 'deliver',
    parts: [part('Reminder: drink water')],
    encoding: 'GSM-7',
    command: null,
    language: 'en',
    outcome: null,
    deliveryOutcome: 'reminder-sent',
    snapshot,
    repliesLeft: 4,
    serverTime: DUE,
  };
}

/** Lets the fetch promise chain settle, then runs the drip timer. */
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

function thread(): string[] {
  const list = screen.getByRole('list', { name: 'Messages' });
  return within(list)
    .queryAllByRole('listitem')
    .map((li) => li.textContent);
}

interface StorageSpies {
  readonly all: readonly MockInstance[];
  readonly idbOpen: MockInstance;
}

/** Spies on every write path of Web Storage, cookies, IndexedDB and the URL history. */
function spyOnStorage(): StorageSpies {
  const idb = { open: (): never => { throw new Error('indexedDB.open must not be called'); } };
  vi.stubGlobal('indexedDB', idb);
  const idbOpen = vi.spyOn(idb, 'open');
  const all: MockInstance[] = [
    vi.spyOn(Storage.prototype, 'setItem'),
    vi.spyOn(Storage.prototype, 'removeItem'),
    vi.spyOn(Storage.prototype, 'clear'),
    vi.spyOn(Document.prototype, 'cookie', 'set'),
    vi.spyOn(window.history, 'pushState'),
    vi.spyOn(window.history, 'replaceState'),
    idbOpen,
  ];
  return { all, idbOpen };
}

describe('Ouija_Simulator storage', () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('writes nothing to localStorage, sessionStorage, cookies, IndexedDB or the URL during a full session', async () => {
    const spies = spyOnStorage();
    const urlBefore = window.location.href;
    render(<OuijaSimulator />);

    // Send a REMIND message by keyboard.
    await user.click(screen.getByRole('button', { name: /^Input:\s*Keypad$/ }));
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'REMIND in 1 minute drink water');
    await user.keyboard('{Enter}');
    await settle();
    expect(f.calls[0]?.type).toBe('message');

    // The reply sets one Reminder due in 1 minute.
    const withReminder: SessionSnapshot = {
      ...emptySnapshot(T0),
      receiveTimes: [T0],
      reminders: [
        { id: 'r:mabc-a', slot: 1, dueAt: DUE, text: 'drink water', language: 'en', createdAt: T0 },
      ],
    };
    f.respond(remindReply(withReminder));
    await settle();
    expect(thread().at(-1)).toContain('Reminder set for 1 minute');

    // At the Due_Time the pump sends a deliver request; the delivery arrives.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DUE - Date.now());
    });
    await settle();
    expect(f.calls[1]).toMatchObject({ type: 'deliver', reminderId: 'r:mabc-a' });
    f.respond(deliverReply({ ...withReminder, reminders: [] }));
    await settle();
    expect(thread().at(-1)).toContain('drink water');

    // New session runs in the browser only.
    await user.click(screen.getByRole('button', { name: 'New session' }));
    await settle();
    expect(thread()).toEqual([NEW_SESSION_TEXT]);
    expect(f.calls).toHaveLength(2);

    for (const spy of spies.all) expect(spy).not.toHaveBeenCalled();
    expect(spies.idbOpen).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    expect(window.location.href).toBe(urlBefore);
  });
});
