import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './ai.mock.js';
import type { MockStep } from './ai.mock.js';
import { AiError } from './ai.types.js';
import type { AiClient, AiErrorKind, Prompt } from './ai.types.js';
import { callWithPolicy } from './answer.call.js';
import type { CallOutcome } from './answer.call.js';
import { CALL_TIMEOUT_MS } from './answer.texts.js';

const prompt: Prompt = { system: 's', user: 'u' };

function errorKind(outcome: CallOutcome): AiErrorKind | null {
  return outcome.ok ? null : outcome.error.kind;
}

describe('callWithPolicy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses an 8000 ms timeout', () => {
    expect(CALL_TIMEOUT_MS).toBe(8_000);
  });

  it('returns the text after 1 call on success', async () => {
    const client = createMockClient([{ text: 'hello' }]);
    const outcome = await callWithPolicy(client, prompt, CALL_TIMEOUT_MS);
    expect(outcome).toEqual({ ok: true, text: 'hello' });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toBe(prompt);
  });

  it('times out a hanging call at 8000 ms, retries once, then gives timeout', async () => {
    const client = createMockClient([{ hang: true }]);
    let settled: CallOutcome | null = null;
    void callWithPolicy(client, prompt, CALL_TIMEOUT_MS).then((o) => {
      settled = o;
    });

    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS - 1);
    expect(settled).toBeNull();
    expect(client.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeNull();
    expect(client.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
    expect(settled).not.toBeNull();
    expect(errorKind(settled as unknown as CallOutcome)).toBe('timeout');
    expect(client.calls).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  const callCounts: readonly (readonly [AiErrorKind, number])[] = [
    ['quota', 1],
    ['unknown', 1],
    ['timeout', 2],
    ['network', 2],
  ];
  for (const [kind, calls] of callCounts) {
    it(`makes ${String(calls)} call(s) for kind ${kind}`, async () => {
      const client = createMockClient([{ error: new AiError(kind) }]);
      const outcome = await callWithPolicy(client, prompt, CALL_TIMEOUT_MS);
      expect(errorKind(outcome)).toBe(kind);
      expect(client.calls).toHaveLength(calls);
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  const retryFirst: readonly MockStep[] = [
    { error: new AiError('network') },
    { error: new AiError('timeout') },
    { hang: true },
  ];
  for (const first of retryFirst) {
    it(`retries once then succeeds after ${JSON.stringify(Object.keys(first))}`, async () => {
      const client = createMockClient([first, { text: 'ok' }]);
      const pending = callWithPolicy(client, prompt, CALL_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
      expect(await pending).toEqual({ ok: true, text: 'ok' });
      expect(client.calls).toHaveLength(2);
    });
  }

  it('ignores a result that arrives after the timeout', async () => {
    let calls = 0;
    const client: AiClient = {
      complete(): Promise<string> {
        calls += 1;
        if (calls === 1) {
          return new Promise<string>((resolve) => {
            setTimeout(() => {
              resolve('late');
            }, CALL_TIMEOUT_MS + 1_000);
          });
        }
        return new Promise<string>(() => undefined);
      },
    };
    let settled: CallOutcome | null = null;
    void callWithPolicy(client, prompt, CALL_TIMEOUT_MS).then((o) => {
      settled = o;
    });
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS + 1_000);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
    expect(settled).not.toBeNull();
    expect(errorKind(settled as unknown as CallOutcome)).toBe('timeout');
    expect(calls).toBe(2);
  });

  it('turns a synchronous throw into unknown with 1 call', async () => {
    const client = createMockClient([{ throws: new Error('boom secret') }]);
    const outcome = await callWithPolicy(client, prompt, CALL_TIMEOUT_MS);
    expect(errorKind(outcome)).toBe('unknown');
    expect(outcome.ok ? '' : outcome.error.message).not.toContain('secret');
    expect(client.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns a non-AiError rejection into unknown with 1 call', async () => {
    for (const value of [new Error('x'), 'text', null, 42]) {
      const client = createMockClient([{ reject: value }]);
      const outcome = await callWithPolicy(client, prompt, CALL_TIMEOUT_MS);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toBeInstanceOf(AiError);
        expect(outcome.error.kind).toBe('unknown');
      }
      expect(client.calls).toHaveLength(1);
    }
  });

  it('turns a non-string resolution into empty text with 1 call', async () => {
    for (const value of [undefined, null, 42, { text: 'x' }]) {
      const client = createMockClient([{ value }]);
      const outcome = await callWithPolicy(client, prompt, CALL_TIMEOUT_MS);
      expect(outcome).toEqual({ ok: true, text: '' });
      expect(client.calls).toHaveLength(1);
    }
  });
});
