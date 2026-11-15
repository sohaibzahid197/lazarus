// Smoke tests for useOuijaSession with fake timers, a fake clock and a mocked fetch.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@lazarus/brain';
import { emptySnapshot } from '../protocol/emptySnapshot';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorRequest, SimulatorResponse } from '../protocol/wire.types';
import { NEW_SESSION_TEXT } from '../ui/texts';
import { DRIP_INTERVAL_MS, useOuijaSession, type SessionEnv } from './useOuijaSession';

const T0 = 1_767_225_600_000;

function reply(snapshot: SessionSnapshot, texts: readonly string[], serverTime: number): SimulatorResponse {
  return {
    kind: 'message',
    parts: texts.map((text) => ({ text, units: text.length, limit: texts.length === 1 ? 160 : 153 })),
    encoding: 'GSM-7',
    command: 'HELP',
    language: 'en',
    outcome: 'replied',
    deliveryOutcome: null,
    snapshot,
    repliesLeft: 4,
    serverTime,
  };
}

interface FakeFetch {
  readonly fetch: SessionEnv['fetch'];
  readonly calls: SimulatorRequest[];
  resolve(body: unknown, status?: number): void;
}

/** A fetch whose responses the test releases one at a time; aborts reject like the real one. */
function fakeFetch(): FakeFetch {
  const calls: SimulatorRequest[] = [];
  const waiting: ((res: Response) => void)[] = [];
  const fetchFn: SessionEnv['fetch'] = (_input, init) => {
    calls.push(JSON.parse(typeof init?.body === 'string' ? init.body : '') as SimulatorRequest);
    return new Promise<Response>((resolve, reject) => {
      waiting.push(resolve);
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  };
  return {
    fetch: fetchFn,
    calls,
    resolve(body, status = 200) {
      waiting.shift()?.(new Response(JSON.stringify(body), { status }));
    },
  };
}

function testEnv(f: FakeFetch): SessionEnv {
  return {
    now: () => Date.now(),
    fetch: f.fetch,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => {
      clearTimeout(h as ReturnType<typeof setTimeout>);
    },
  };
}

async function flush(): Promise<void> {
  // Response promise chain, then the 0 ms drip timer it schedules.
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

describe('useOuijaSession', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends one message request and drips parts 700 ms apart', async () => {
    const f = fakeFetch();
    const { result } = renderHook(() => useOuijaSession(testEnv(f)));
    act(() => {
      result.current.send('HELP');
    });
    await flush();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ type: 'message', body: 'HELP' });
    act(() => {
      result.current.send('again');
    });
    await flush();
    expect(f.calls).toHaveLength(1);

    const snap = emptySnapshot(T0);
    f.resolve(reply(snap, ['(1/2) one', '(2/2) two'], T0 + 5_000));
    await flush();
    const texts = (): string[] => result.current.state.bubbles.map((b) => b.text);
    expect(texts()).toEqual(['HELP', '(1/2) one']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRIP_INTERVAL_MS - 1);
    });
    expect(texts()).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(texts()).toEqual(['HELP', '(1/2) one', '(2/2) two']);
    expect(result.current.state.clockOffset).toBe(5_000);
    expect(result.current.state.repliesLeft).toBe(4);
  });

  it('sends a deliver request when a Reminder falls due', async () => {
    const f = fakeFetch();
    const { result } = renderHook(() => useOuijaSession(testEnv(f)));
    act(() => {
      result.current.send('REMIND in 1 minute drink water');
    });
    await flush();
    const snap: SessionSnapshot = {
      ...emptySnapshot(T0),
      reminders: [
        { id: 'r:a', slot: 1, dueAt: T0 + 60_000, text: 'drink water', language: 'en', createdAt: T0 },
      ],
    };
    f.resolve(reply(snap, ['ok'], T0));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(f.calls).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]).toMatchObject({ type: 'deliver', reminderId: 'r:a' });
  });

  it('New session aborts, sends nothing and ignores the late response', async () => {
    const f = fakeFetch();
    const { result } = renderHook(() => useOuijaSession(testEnv(f)));
    act(() => {
      result.current.send('HELP');
    });
    await flush();
    act(() => {
      result.current.newSession();
    });
    await flush();
    expect(f.calls).toHaveLength(1);
    f.resolve(reply(emptySnapshot(T0), ['late'], T0));
    await flush();
    const s = result.current.state;
    expect(s.bubbles.map((b) => b.text)).toEqual([NEW_SESSION_TEXT]);
    expect(s.inFlight).toBeNull();
    expect(s.waitingMessage).toBeNull();
    expect(s.repliesLeft).toBe(DEFAULT_SETTINGS.perNumberLimit);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(f.calls).toHaveLength(1);
  });
});
