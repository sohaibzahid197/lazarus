import { describe, expect, it } from 'vitest';
import { FIXED_TEXTS } from './answer.texts.js';
import { reserveParts, zeroCounters } from './gateway.counters.js';
import {
  applyChanges,
  completeReply,
  evaluateInbound,
  orderInbound,
  type EvalStep,
} from './gateway.pipeline.js';
import { DEFAULT_SETTINGS } from './gateway.settings.js';
import { GATEWAY_TEXTS } from './gateway.texts.js';
import type {
  CanonicalNumber,
  GatewayDecision,
  GatewayState,
  InboundMessage,
  PipelineContext,
} from './gateway.types.js';
import { routeCommand } from './router.js';
import type { RoutedCommand } from './router.types.js';
import { splitSms } from './sms.js';
import { EMPTY_REMINDERS } from './reminder.types.js';

const DAY = '2024-01-01';
const T0 = Date.UTC(2024, 0, 1, 6, 0);
const NUM = '+923001234567' as CanonicalNumber;
const RUN: PipelineContext = { paused: false, today: DAY };

const baseState = (over: Partial<GatewayState> = {}): GatewayState => ({
  reminders: EMPTY_REMINDERS,
  stopList: new Set(),
  allowlist: new Set(),
  rate: new Map(),
  slowDown: new Map(),
  counters: zeroCounters(DAY),
  settings: DEFAULT_SETTINGS,
  ...over,
});

let seq = 0;
const msg = (body: string, sender = '03001234567', receivedAt = T0): InboundMessage => ({
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

/** Resolves fixed-text steps; AI steps are answered with `aiText`. */
function decide(step: EvalStep, state: GatewayState, aiText = 'AI answer'): GatewayDecision {
  if (step.kind === 'final') return step.decision;
  const text = step.kind === 'reply' ? step.text : aiText;
  return completeReply(step.pending, text, state, splitSms);
}

const run = (m: InboundMessage, s: GatewayState, ctx = RUN, ai = true): GatewayDecision =>
  decide(evaluateInbound(m, s, ctx, routeCommand, ai), s);

describe('gateway.pipeline smoke', () => {
  it('ignores automated senders and the Own_Number without routing', () => {
    const r = countingRouter();
    const own = baseState({ settings: { ...DEFAULT_SETTINGS, ownNumber: NUM } });
    const a = evaluateInbound(msg('STOP', 'JAZZ'), own, RUN, r.route, true);
    const b = evaluateInbound(msg('HELP', '+92 300 1234567'), own, RUN, r.route, true);
    expect(a.kind === 'final' && a.decision.outcome).toBe('ignored-automated');
    expect(b.kind === 'final' && b.decision.outcome).toBe('ignored-own-number');
    expect(a.kind === 'final' && a.decision.changes).toEqual([]);
    expect(r.calls()).toBe(0);
  });

  it('records STOP once, even when capped, rate-limited, not allowed or paused', () => {
    const s = baseState({
      stopList: new Set([NUM]),
      settings: { ...DEFAULT_SETTINGS, allowlistMode: true, dailySendCap: 1, perNumberLimit: 1 },
      counters: reserveParts(zeroCounters(DAY), DAY, 1),
      rate: new Map([[NUM, [T0]]]),
    });
    for (const ctx of [RUN, { ...RUN, paused: true }]) {
      const d = run(msg('stop'), s, ctx);
      expect(d.outcome).toBe('stopped');
      expect(d.parts).toEqual([]);
      expect(d.changes).toEqual([
            { type: 'stop-add', number: NUM },
            { type: 'reminder-remove-all', number: NUM },
          ]);
      expect([...applyChanges(s, d.changes).stopList]).toEqual([NUM]);
    }
  });

  it('paused: everything but STOP is ignored-paused with no changes', () => {
    const d = run(msg('HELP'), baseState(), { ...RUN, paused: true });
    expect(d.outcome).toBe('ignored-paused');
    expect(d.changes).toEqual([]);
  });

  it('START removes the number and welcomes back; Allowlist gate gives started with 0 parts', () => {
    const s = baseState({ stopList: new Set([NUM]) });
    const d = run(msg('START'), s);
    expect(d.outcome).toBe('started');
    expect(d.parts).toEqual(splitSms(GATEWAY_TEXTS.en.welcomeBack));
    expect(applyChanges(s, d.changes).stopList.has(NUM)).toBe(false);

    const gated = baseState({
      stopList: new Set([NUM]),
      allowlist: 'unreadable',
      settings: { ...DEFAULT_SETTINGS, allowlistMode: true },
    });
    const g = run(msg('START'), gated);
    expect(g.outcome).toBe('started');
    expect(g.parts).toEqual([]);
    expect(g.changes).toEqual([{ type: 'stop-remove', number: NUM }]);
  });

  it('Stop_List and Allowlist_Mode end evaluation before the limiter', () => {
    expect(run(msg('HELP'), baseState({ stopList: new Set([NUM]) })).outcome).toBe('ignored-stopped');
    const gated = baseState({ settings: { ...DEFAULT_SETTINGS, allowlistMode: true } });
    const d = run(msg('HELP'), gated);
    expect(d.outcome).toBe('ignored-not-allowed');
    expect(d.changes).toEqual([]);
  });

  it('sends Slow_Down_Text once per window when rate-limited', () => {
    const s0 = baseState({ settings: { ...DEFAULT_SETTINGS, perNumberLimit: 1 } });
    const first = run(msg('HELP'), s0);
    expect(first.outcome).toBe('replied');
    const s1 = applyChanges(s0, first.changes);
    const second = run(msg('HELP', undefined, T0 + 1), s1);
    expect(second.outcome).toBe('rate-limited');
    expect(second.parts).toEqual(splitSms(GATEWAY_TEXTS.en.slowDown));
    const s2 = applyChanges(s1, second.changes);
    const third = run(msg('HELP', undefined, T0 + 2), s2);
    expect(third.outcome).toBe('rate-limited');
    expect(third.parts).toEqual([]);
    expect(s2.rate.get(NUM)).toEqual([T0]);
  });

  it('applies the Daily_Send_Cap before routing and after splitting', () => {
    const capped = baseState({
      settings: { ...DEFAULT_SETTINGS, dailySendCap: 2 },
      counters: reserveParts(zeroCounters(DAY), DAY, 2),
    });
    const step = evaluateInbound(msg('what is rain?'), capped, RUN, routeCommand, true);
    expect(step.kind === 'final' && step.decision.outcome).toBe('send-capped');

    const nearly = { ...capped, counters: reserveParts(zeroCounters(DAY), DAY, 1) };
    const long = 'word '.repeat(80);
    const over = decide(evaluateInbound(msg('what is rain?'), nearly, RUN, routeCommand, true), nearly, long);
    expect(over.outcome).toBe('send-capped');
    expect(over.parts).toEqual([]);
    const fits = run(msg('HELP'), nearly);
    expect(fits.outcome).toBe('replied');
    expect(applyChanges(nearly, fits.changes).counters.handed).toBe(2);
  });

  it('asks the Answer_Service only with argument and language, or uses Try_Later_Text without a key', () => {
    const s = baseState();
    const step = evaluateInbound(msg('what is rain?'), s, RUN, routeCommand, true);
    expect(step.kind).toBe('answer');
    if (step.kind === 'answer') {
      expect(step.request).toEqual({ kind: 'question', argument: 'what is rain?', language: 'en' });
    }
    const noKey = run(msg('SCAM you won a prize'), s, RUN, false);
    expect(noKey.parts).toEqual(splitSms(FIXED_TEXTS.en.tryLater));
    expect(run(msg('REMIND'), s).parts).toEqual(splitSms(GATEWAY_TEXTS.en.usage.REMIND));
    expect(run(msg('TRANSLATE hello'), s).parts).toEqual(splitSms(GATEWAY_TEXTS.en.notAvailable));
  });

  it('never puts the body into a decision', () => {
    const body = 'secret body text 12345';
    const d = run(msg(body), baseState(), RUN, false);
    expect(JSON.stringify(d)).not.toContain(body);
  });

  it('orders inbound by receivedAt then seq', () => {
    const a = { ...msg('a'), receivedAt: 5, seq: 2 };
    const b = { ...msg('b'), receivedAt: 5, seq: 1 };
    const c = { ...msg('c'), receivedAt: 1, seq: 9 };
    expect(orderInbound([a, b, c]).map((m) => m.body)).toEqual(['c', 'b', 'a']);
  });
});
