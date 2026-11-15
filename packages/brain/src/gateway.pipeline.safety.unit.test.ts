// Unit tests for the STOP safety rules and the Requirement 7.3 check order (task 9.14).
// Requirements 3.2, 3.8, 4.8, 4.9, 4.11, 7.3, 9.11, 18.7.
import { describe, expect, it } from 'vitest';
import { createMockClient } from './ai.mock.js';
import { createMemoryCache } from './answer.cache.js';
import type { AnswerDeps } from './answer.types.js';
import { reserveParts, zeroCounters } from './gateway.counters.js';
import {
  applyChanges,
  completeReply,
  evaluateInbound,
  finalizeSend,
  runGatewayPipeline,
  type EvalStep,
  type PipelineDeps,
} from './gateway.pipeline.js';
import { DEFAULT_SETTINGS } from './gateway.settings.js';
import { GATEWAY_TEXTS } from './gateway.texts.js';
import type {
  CanonicalNumber,
  GatewayDecision,
  GatewaySettings,
  GatewayState,
  InboundMessage,
  PipelineContext,
} from './gateway.types.js';
import { routeCommand } from './router.js';
import type { RoutedCommand } from './router.types.js';
import { splitSms } from './sms.js';

const DAY = '2024-01-01';
const T0 = Date.UTC(2024, 0, 1, 6, 0);
const NUM = '+923001234567' as CanonicalNumber;
const SENDER = '03001234567'; // normalizes to NUM with Default_Country_Code 92
const RUN: PipelineContext = { paused: false, today: DAY };
const PAUSED: PipelineContext = { paused: true, today: DAY };

const settings = (over: Partial<GatewaySettings> = {}): GatewaySettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
});

const baseState = (over: Partial<GatewayState> = {}): GatewayState => ({
  stopList: new Set(),
  allowlist: new Set(),
  rate: new Map(),
  slowDown: new Map(),
  counters: zeroCounters(DAY),
  settings: DEFAULT_SETTINGS,
  ...over,
});

let seq = 0;
const msg = (body: string, sender = SENDER, receivedAt = T0): InboundMessage => ({
  id: `m${++seq}`,
  seq,
  sender,
  body,
  receivedAt,
});

function countingRouter(): { route: (s: string) => RoutedCommand; calls: () => number } {
  let n = 0;
  return { route: (s) => (n++, routeCommand(s)), calls: () => n };
}

/** Resolves a step synchronously; AI steps get a fixed answer. */
function decide(step: EvalStep, state: GatewayState): GatewayDecision {
  if (step.kind === 'final') return step.decision;
  const text = step.kind === 'reply' ? step.text : 'AI answer';
  return completeReply(step.pending, text, state, splitSms);
}

const run = (m: InboundMessage, s: GatewayState, ctx = RUN): GatewayDecision =>
  decide(evaluateInbound(m, s, ctx, routeCommand, true), s);

const noopTimer: NonNullable<PipelineDeps['startTimer']> = () => () => undefined;

const answerDeps = (): AnswerDeps => ({
  client: createMockClient([{ text: 'unused' }]),
  cache: createMemoryCache(),
  clock: () => T0,
});

/** Over the limit: perNumberLimit 1 with one accepted message in the window. */
const overLimit = { rate: new Map([[NUM, [T0 - 1]]]) } as const;
/** Cap reached: dailySendCap 1 with 1 part already handed today. */
const atCap = { counters: reserveParts(zeroCounters(DAY), DAY, 1) } as const;

const expectStopAdded = (s: GatewayState, d: GatewayDecision): void => {
  expect(d.outcome).toBe('stopped');
  expect(d.parts).toEqual([]);
  expect(d.changes).toEqual([{ type: 'stop-add', number: NUM }]);
  expect([...applyChanges(s, d.changes).stopList]).toEqual([NUM]);
};

describe('STOP always wins (Requirement 3.2, 9.11)', () => {
  it('adds STOP under Allowlist_Mode for a sender not on the Allowlist', () => {
    const s = baseState({ settings: settings({ allowlistMode: true }) });
    expectStopAdded(s, run(msg('STOP'), s));
  });

  it('adds STOP when the sender is over the Per_Number_Limit', () => {
    const s = baseState({ ...overLimit, settings: settings({ perNumberLimit: 1 }) });
    expectStopAdded(s, run(msg('STOP'), s));
  });

  it('adds STOP when the Daily_Send_Cap is reached', () => {
    const s = baseState({ ...atCap, settings: settings({ dailySendCap: 1 }) });
    expectStopAdded(s, run(msg('STOP'), s));
  });

  it('adds STOP while the Operator has paused the gateway', () => {
    const s = baseState();
    expectStopAdded(s, run(msg('STOP'), s, PAUSED));
  });
});

describe('Sms_Sender refused-stopped (Requirement 3.8)', () => {
  it('records ignored-stopped, 0 parts sent and releases the reserved parts', () => {
    const s = baseState();
    const d = run(msg('HELP'), s);
    expect(d.parts.length).toBeGreaterThan(0);
    const after = applyChanges(s, d.changes).counters;
    const fin = finalizeSend(d, { status: 'refused-stopped' }, after, DAY);
    expect(fin.outcome).toBe('ignored-stopped');
    expect(fin.partsSent).toBe(0);
    const counters = applyChanges(s, fin.changes).counters;
    expect(counters.handed).toBe(0);
    expect(counters.partsSent).toBe(0);
  });
});

describe('START under Allowlist_Mode (Requirement 4.8, 4.9, 4.11)', () => {
  it('START from a stopped number not on the Allowlist: stop-remove, started, 0 parts', () => {
    const s = baseState({ stopList: new Set([NUM]), settings: settings({ allowlistMode: true }) });
    const d = run(msg('START'), s);
    expect(d.outcome).toBe('started');
    expect(d.parts).toEqual([]);
    expect(d.changes).toEqual([{ type: 'stop-remove', number: NUM }]);
    const next = applyChanges(s, d.changes);
    expect(next.stopList.has(NUM)).toBe(false);
    expect(next.rate).toEqual(s.rate);
    expect(next.counters).toEqual(s.counters);
  });

  it('START with an unreadable Allowlist: stop-remove, started, 0 parts; HELP is ignored-not-allowed', () => {
    const s = baseState({
      stopList: new Set([NUM]),
      allowlist: 'unreadable',
      settings: settings({ allowlistMode: true }),
    });
    const d = run(msg('START'), s);
    expect(d.outcome).toBe('started');
    expect(d.parts).toEqual([]);
    expect(d.changes).toEqual([{ type: 'stop-remove', number: NUM }]);

    const next = applyChanges(s, d.changes);
    const help = run(msg('HELP'), next);
    expect(help.outcome).toBe('ignored-not-allowed');
    expect(help.parts).toEqual([]);
    expect(help.changes).toEqual([]);
  });
});

describe('Check order of Requirement 7.3 (earlier check wins)', () => {
  it('paused before Automated_Sender: a STOP from a short code while paused is ignored-paused', () => {
    const r = countingRouter();
    const step = evaluateInbound(msg('STOP', '12345'), baseState(), PAUSED, r.route, true);
    expect(step.kind === 'final' && step.decision.outcome).toBe('ignored-paused');
    expect(step.kind === 'final' && step.decision.changes).toEqual([]);
    expect(r.calls()).toBe(0);
  });

  it('Automated_Sender before Own_Number', () => {
    // An Automated_Sender has no Canonical_Number, so it can never equal the Own_Number;
    // with an Own_Number set, the Automated_Sender check still decides first.
    const r = countingRouter();
    const s = baseState({ settings: settings({ ownNumber: NUM }) });
    const step = evaluateInbound(msg('STOP', 'JAZZ'), s, RUN, r.route, true);
    expect(step.kind === 'final' && step.decision.outcome).toBe('ignored-automated');
    expect(r.calls()).toBe(0);
  });

  it('Own_Number before STOP handling', () => {
    const r = countingRouter();
    const s = baseState({ settings: settings({ ownNumber: NUM }) });
    const step = evaluateInbound(msg('STOP'), s, RUN, r.route, true);
    expect(step.kind === 'final' && step.decision.outcome).toBe('ignored-own-number');
    expect(step.kind === 'final' && step.decision.changes).toEqual([]);
    expect(r.calls()).toBe(0);
  });

  it('STOP and START handling before the Stop_List check', () => {
    const s = baseState({ stopList: new Set([NUM]) });
    const stop = run(msg('STOP'), s);
    expect(stop.outcome).toBe('stopped');
    const start = run(msg('START'), s);
    expect(start.outcome).toBe('started');
    expect(start.parts).toEqual(splitSms(GATEWAY_TEXTS.en.welcomeBack));
    expect(start.changes[0]).toEqual({ type: 'stop-remove', number: NUM });
  });

  it('Stop_List before Allowlist_Mode', () => {
    const s = baseState({ stopList: new Set([NUM]), settings: settings({ allowlistMode: true }) });
    const d = run(msg('HELP'), s);
    expect(d.outcome).toBe('ignored-stopped');
    expect(d.changes).toEqual([]);
  });

  it('Allowlist_Mode before the Rate_Limiter', () => {
    const s = baseState({ ...overLimit, settings: settings({ allowlistMode: true, perNumberLimit: 1 }) });
    const d = run(msg('HELP'), s);
    expect(d.outcome).toBe('ignored-not-allowed');
    expect(d.parts).toEqual([]);
    expect(d.changes).toEqual([]);
  });

  it('Rate_Limiter before the Daily_Send_Cap', () => {
    const s = baseState({
      ...overLimit,
      ...atCap,
      slowDown: new Map([[NUM, T0 - 1]]), // Slow_Down_Text already sent in this window
      settings: settings({ perNumberLimit: 1, dailySendCap: 1 }),
    });
    const step = evaluateInbound(msg('HELP'), s, RUN, routeCommand, true);
    expect(step.kind).toBe('final');
    expect(step.kind === 'final' && step.decision.outcome).toBe('rate-limited');
    expect(step.kind === 'final' && step.decision.changes).toEqual([]);
  });

  it('Daily_Send_Cap before command routing: no Answer_Service call', async () => {
    let asked = 0;
    const deps: PipelineDeps = {
      answer: answerDeps(),
      answerQuestion: async () => (asked++, 'AI answer'),
      checkScam: async () => (asked++, 'AI answer'),
      startTimer: noopTimer,
    };
    const s = baseState({ ...atCap, settings: settings({ dailySendCap: 1 }) });
    for (const body of ['what is rain?', 'SCAM you won a prize', 'HELP']) {
      const d = await runGatewayPipeline(msg(body), s, RUN, deps);
      expect(d.outcome).toBe('send-capped');
      expect(d.parts).toEqual([]);
      expect(d.changes).toEqual([{ type: 'rate-record', number: NUM, at: T0 }]);
    }
    expect(asked).toBe(0);
  });
});
