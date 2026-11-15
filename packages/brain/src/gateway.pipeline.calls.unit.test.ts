// Unit tests for routing calls and timeouts (task 9.16).
// Requirements 6.1, 6.2, 6.3, 6.8, 6.13, 6.14, 6.15.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './ai.mock.js';
import { createMemoryCache } from './answer.cache.js';
import { answerQuestion } from './answer.service.js';
import { FIXED_TEXTS } from './answer.texts.js';
import type { AnswerDeps } from './answer.types.js';
import { zeroCounters } from './gateway.counters.js';
import { runGatewayPipeline, type PipelineDeps } from './gateway.pipeline.js';
import { DEFAULT_SETTINGS } from './gateway.settings.js';
import type { GatewayDecision, GatewayState, InboundMessage, PipelineContext } from './gateway.types.js';
import { routeCommand } from './router.js';
import type { Language } from './router.types.js';
import { splitSms } from './sms.js';

const DAY = '2024-01-01';
const T0 = Date.UTC(2024, 0, 1, 6, 0);
const RUN: PipelineContext = { paused: false, today: DAY };
const BACKSTOP_MS = 25_000;

const state: GatewayState = {
  stopList: new Set(),
  allowlist: new Set(),
  rate: new Map(),
  slowDown: new Map(),
  counters: zeroCounters(DAY),
  settings: DEFAULT_SETTINGS,
};

const msg = (body: string): InboundMessage => ({
  id: 'm1',
  seq: 1,
  sender: '03001234567',
  body,
  receivedAt: T0,
});

const answerDeps = (overrides: Partial<AnswerDeps> = {}): AnswerDeps => ({
  client: createMockClient([{ text: 'unused' }]),
  cache: createMemoryCache(),
  clock: () => T0,
  ...overrides,
});

/** Tracks whether the pipeline promise has settled, without awaiting it. */
function track(p: Promise<GatewayDecision>): { settled: () => boolean } {
  let done = false;
  void p.then(() => {
    done = true;
  });
  return { settled: () => done };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('router, answer and splitter calls', () => {
  it('calls the router once with the exact body and answerQuestion once with the argument and Language', async () => {
    const body = '  how to grow   RICE?  ';
    const route = vi.fn(routeCommand);
    const split = vi.fn(splitSms);
    const ask = vi.fn(
      async (_d: AnswerDeps, _q: string, _l?: Language): Promise<string> => 'Rice needs water.',
    );
    const scam = vi.fn(async (): Promise<string> => 'x');
    const deps: PipelineDeps = { answer: answerDeps(), route, split, answerQuestion: ask, checkScam: scam };

    const d = await runGatewayPipeline(msg(body), state, RUN, deps);

    const routed = routeCommand(body);
    expect(route).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledWith(body);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]?.slice(1)).toEqual([routed.argument, routed.language]);
    expect(scam).not.toHaveBeenCalled();
    expect(split).toHaveBeenCalledTimes(1);
    expect(split).toHaveBeenCalledWith('Rice needs water.');
    expect(d.language).toBe(routed.language);
    expect(d.parts).toEqual(['Rice needs water.']);
  });

  it('calls checkScam once with the SCAM argument and the Roman Urdu Language', async () => {
    const body = 'SCAM aap ka inaam nikla hai, apna pin bhejein';
    const routed = routeCommand(body);
    const route = vi.fn(routeCommand);
    const split = vi.fn(splitSms);
    const ask = vi.fn(async (): Promise<string> => 'x');
    const scam = vi.fn(
      async (_d: AnswerDeps, _t: string, _l?: Language): Promise<string> => 'Yeh fraud lagta hai.',
    );
    const deps: PipelineDeps = { answer: answerDeps(), route, split, answerQuestion: ask, checkScam: scam };

    const d = await runGatewayPipeline(msg(body), state, RUN, deps);

    expect(routed.command).toBe('SCAM');
    expect(route).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledWith(body);
    expect(scam).toHaveBeenCalledTimes(1);
    expect(scam.mock.calls[0]?.slice(1)).toEqual([routed.argument, routed.language]);
    expect(ask).not.toHaveBeenCalled();
    expect(split).toHaveBeenCalledTimes(1);
    expect(split).toHaveBeenCalledWith('Yeh fraud lagta hai.');
    expect(d.language).toBe(routed.language);
  });

  it('uses the Language returned by an injected router for the answer call', async () => {
    const route = vi.fn((_input: string) => ({
      command: 'QUESTION' as const,
      argument: 'gandum ka beej',
      language: 'roman-ur' as Language,
      argumentMissing: false,
    }));
    const ask = vi.fn(async (_d: AnswerDeps, _q: string, _l?: Language): Promise<string> => 'Jawab.');
    const split = vi.fn(splitSms);
    const deps: PipelineDeps = { answer: answerDeps(), route, split, answerQuestion: ask };

    const d = await runGatewayPipeline(msg('anything'), state, RUN, deps);

    expect(route).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledWith('anything');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]?.slice(1)).toEqual(['gandum ka beej', 'roman-ur']);
    expect(split).toHaveBeenCalledTimes(1);
    expect(d.language).toBe('roman-ur');
  });
});

describe('25 s backstop', () => {
  it('gives the Try_Later_Text at 25 s and discards a late answer', async () => {
    vi.useFakeTimers();
    let release: (text: string) => void = () => undefined;
    const split = vi.fn(splitSms);
    const deps: PipelineDeps = {
      answer: answerDeps(),
      split,
      answerQuestion: () => new Promise<string>((r) => (release = r)),
    };

    const pending = runGatewayPipeline(msg('how to grow rice'), state, RUN, deps);
    const status = track(pending);

    await vi.advanceTimersByTimeAsync(BACKSTOP_MS - 1);
    expect(status.settled()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(status.settled()).toBe(true);
    const d = await pending;
    expect(d.parts).toEqual(splitSms(FIXED_TEXTS.en.tryLater));

    release('late answer');
    await vi.advanceTimersByTimeAsync(BACKSTOP_MS);
    expect(split).toHaveBeenCalledTimes(1);
    expect(split).toHaveBeenCalledWith(FIXED_TEXTS.en.tryLater);
    expect(d.parts).toEqual(splitSms(FIXED_TEXTS.en.tryLater));
  });

  it('gives the Try_Later_Text at 25 s with a hanging Mock_Client and the real answerQuestion', async () => {
    vi.useFakeTimers();
    const client = createMockClient([{ hang: true }]);
    const split = vi.fn(splitSms);
    const deps: PipelineDeps = {
      // Per-call timeout above the backstop, so the 25 s backstop fires first.
      answer: answerDeps({ client, timeoutMs: 60_000 }),
      split,
      answerQuestion,
    };
    const body = 'gandum ko pani kab dena chahiye';
    const lang = routeCommand(body).language;

    const pending = runGatewayPipeline(msg(body), state, RUN, deps);
    const status = track(pending);

    await vi.advanceTimersByTimeAsync(BACKSTOP_MS - 1);
    expect(status.settled()).toBe(false);
    expect(client.calls.length).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(status.settled()).toBe(true);
    const d = await pending;
    expect(d.outcome).toBe('replied');
    expect(d.parts).toEqual(splitSms(FIXED_TEXTS[lang].tryLater));

    // Let the Answer_Service's own timeouts and retry run out; nothing more is split.
    await vi.advanceTimersByTimeAsync(130_000);
    expect(split).toHaveBeenCalledTimes(1);
  });
});

describe('throwing router', () => {
  it('gives the en Try_Later_Text and calls the router once', async () => {
    const route = vi.fn((_input: string) => {
      throw new Error('router');
    });
    const ask = vi.fn(async (): Promise<string> => 'x');
    const split = vi.fn(splitSms);
    const deps: PipelineDeps = { answer: answerDeps(), route, split, answerQuestion: ask };

    const d = await runGatewayPipeline(msg('آج موسم کیسا ہے'), state, RUN, deps);

    expect(route).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
    expect(split).toHaveBeenCalledTimes(1);
    expect(split).toHaveBeenCalledWith(FIXED_TEXTS.en.tryLater);
    expect(d.language).toBe('en');
    expect(d.parts).toEqual(splitSms(FIXED_TEXTS.en.tryLater));
  });
});
