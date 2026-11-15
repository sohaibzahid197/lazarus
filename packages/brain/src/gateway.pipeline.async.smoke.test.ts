// Smoke tests for runGatewayPipeline and finalizeSend (task 9.1).
// Full unit and property tests come in tasks 9.2–9.16.
import { describe, expect, it } from 'vitest';
import { createMockClient } from './ai.mock.js';
import { createMemoryCache } from './answer.cache.js';
import { FIXED_TEXTS } from './answer.texts.js';
import type { AnswerDeps } from './answer.types.js';
import { reserveParts, zeroCounters } from './gateway.counters.js';
import { finalizeSend, runGatewayPipeline, type PipelineDeps } from './gateway.pipeline.js';
import { DEFAULT_SETTINGS } from './gateway.settings.js';
import type {
  CanonicalNumber,
  GatewayDecision,
  GatewayState,
  InboundMessage,
  PipelineContext,
} from './gateway.types.js';
import type { Language } from './router.types.js';
import { EMPTY_REMINDERS } from './reminder.types.js';

const DAY = '2024-01-01';
const T0 = Date.UTC(2024, 0, 1, 6, 0);
const NUM = '+923001234567' as CanonicalNumber;
const RUN: PipelineContext = { paused: false, today: DAY };
const TRY_LATER = FIXED_TEXTS.en.tryLater;

const state: GatewayState = {
  reminders: EMPTY_REMINDERS,
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

const answerDeps = (): AnswerDeps => ({
  client: createMockClient([{ text: 'unused' }]),
  cache: createMemoryCache(),
  clock: () => T0,
});

/** A manual timer: `fire()` runs the backstop; `cancelled` tells whether it was cleared. */
function manualTimer(): {
  startTimer: NonNullable<PipelineDeps['startTimer']>;
  fire: () => void;
  cancelled: () => boolean;
  ms: () => number | null;
} {
  let fn: (() => void) | null = null;
  let wasCancelled = false;
  let gotMs: number | null = null;
  return {
    startTimer: (ms, fire) => {
      gotMs = ms;
      fn = fire;
      return () => {
        wasCancelled = true;
      };
    },
    fire: () => fn?.(),
    cancelled: () => wasCancelled,
    ms: () => gotMs,
  };
}

describe('runGatewayPipeline', () => {
  it('passes only the argument and Language to answerQuestion and clears the timer', async () => {
    const calls: unknown[][] = [];
    const timer = manualTimer();
    const deps: PipelineDeps = {
      answer: answerDeps(),
      answerQuestion: async (...args) => {
        calls.push(args.slice(1));
        return 'Rice needs water.';
      },
      startTimer: timer.startTimer,
    };
    const d = await runGatewayPipeline(msg('how to grow rice'), state, RUN, deps);
    expect(calls).toEqual([['how to grow rice', 'en']]);
    expect(d.outcome).toBe('replied');
    expect(d.parts).toEqual(['Rice needs water.']);
    expect(timer.cancelled()).toBe(true);
    expect(timer.ms()).toBe(25_000);
  });

  it('routes SCAM to checkScam', async () => {
    let scamArg: string | null = null;
    const deps: PipelineDeps = {
      answer: answerDeps(),
      checkScam: async (_d, arg) => {
        scamArg = arg;
        return 'Looks like a scam.';
      },
      startTimer: manualTimer().startTimer,
    };
    const d = await runGatewayPipeline(msg('SCAM you won a prize'), state, RUN, deps);
    expect(scamArg).toBe('you won a prize');
    expect(d.parts).toEqual(['Looks like a scam.']);
  });

  it('uses the Try_Later_Text when the backstop fires and ignores the late answer', async () => {
    const timer = manualTimer();
    let release: (text: string) => void = () => undefined;
    const deps: PipelineDeps = {
      answer: answerDeps(),
      answerQuestion: () => new Promise<string>((r) => (release = r)),
      startTimer: timer.startTimer,
    };
    const pending = runGatewayPipeline(msg('hello there'), state, RUN, deps);
    timer.fire();
    release('late answer');
    const d = await pending;
    expect(d.parts).toEqual([TRY_LATER]);
  });

  it('falls back to the Try_Later_Text when the answer service throws', async () => {
    const deps: PipelineDeps = {
      answer: answerDeps(),
      answerQuestion: (_d: AnswerDeps, _q: string, _l?: Language): Promise<string> => {
        throw new Error('boom');
      },
      startTimer: manualTimer().startTimer,
    };
    const d = await runGatewayPipeline(msg('hello there'), state, RUN, deps);
    expect(d.parts).toEqual([TRY_LATER]);
  });

  it('uses the en Try_Later_Text when the router throws', async () => {
    const deps: PipelineDeps = {
      answer: answerDeps(),
      route: () => {
        throw new Error('router');
      },
    };
    const d = await runGatewayPipeline(msg('kuch bhi'), state, RUN, deps);
    expect(d.parts).toEqual([TRY_LATER]);
  });

  it('uses the literal Try_Later_Text when the splitter throws', async () => {
    const deps: PipelineDeps = {
      answer: null,
      split: () => {
        throw new Error('split');
      },
    };
    const d = await runGatewayPipeline(msg('HELP'), state, RUN, deps);
    expect(d.outcome).toBe('replied');
    expect(d.parts).toEqual([TRY_LATER]);
  });

  it('gives the Try_Later_Text without an AI call when no key is readable', async () => {
    let called = false;
    const deps: PipelineDeps = {
      answer: null,
      answerQuestion: async () => {
        called = true;
        return 'x';
      },
    };
    const d = await runGatewayPipeline(msg('hello there'), state, RUN, deps);
    expect(called).toBe(false);
    expect(d.parts).toEqual([TRY_LATER]);
  });
});

describe('finalizeSend', () => {
  const decision = (parts: string[]): GatewayDecision => ({
    messageId: 'm1',
    receivedAt: T0,
    sender: { kind: 'phone', number: NUM },
    command: 'QUESTION',
    language: 'en',
    outcome: 'replied',
    parts,
    changes: [],
  });
  const handed2 = reserveParts(zeroCounters(DAY), DAY, 2);

  it('keeps the Outcome when every part is sent', () => {
    const f = finalizeSend(decision(['a', 'b']), { status: 'done', results: ['sent', 'sent'], attempts: 2 }, handed2, DAY);
    expect(f.outcome).toBe('replied');
    expect(f.partsSent).toBe(2);
    expect(f.changes).toEqual([
      { type: 'counters', counters: { ...handed2, received: 1, repliesSent: 1, replied: 1, partsSent: 2 } },
    ]);
  });

  it('records send-failed with the sent count on any failure', () => {
    const f = finalizeSend(decision(['a', 'b']), { status: 'done', results: ['sent', 'failed-radio'], attempts: 2 }, handed2, DAY);
    expect(f.outcome).toBe('send-failed');
    expect(f.partsSent).toBe(1);
  });

  it('releases handed parts on refused-stopped and cancelled', () => {
    for (const status of ['refused-stopped', 'cancelled'] as const) {
      const f = finalizeSend(decision(['a', 'b']), { status }, handed2, DAY);
      expect(f.outcome).toBe('ignored-stopped');
      expect(f.partsSent).toBe(0);
      expect(f.changes).toEqual([
        { type: 'counters', counters: { ...zeroCounters(DAY), received: 1, ignored: 1 } },
      ]);
    }
  });

  it('counts 0 parts when there is no report', () => {
    const f = finalizeSend({ ...decision([]), outcome: 'stopped' }, null, zeroCounters(DAY), DAY);
    expect(f.outcome).toBe('stopped');
    expect(f.partsSent).toBe(0);
  });
});
