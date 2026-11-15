// Feature: necromancer-sms-gateway, Property 14: At most one Slow_Down_Text per window
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GATEWAY_PBT_OPTIONS,
  body,
  canonicalNumber,
  dayKeyArb,
  languageArb,
  timeArb,
} from './gateway.arbitraries.js';
import { applyChanges, completeReply, evaluateInbound } from './gateway.pipeline.js';
import { GATEWAY_TEXTS } from './gateway.texts.js';
import type {
  CanonicalNumber,
  GatewayDecision,
  GatewayState,
  InboundMessage,
} from './gateway.types.js';
import { routeCommand } from './router.js';
import { joinSms, splitSms } from './sms.js';

const MS_PER_MINUTE = 60_000;
/** Generous cap: 40 messages × at most 4 parts never reach it, so no reply is capped. */
const DAILY_SEND_CAP = 2000;

interface Scenario {
  readonly number: CanonicalNumber;
  readonly perNumberLimit: number;
  readonly windowMinutes: number;
  readonly today: string;
  readonly start: number;
  readonly messages: readonly { readonly gap: number; readonly body: string }[];
}

/** Bodies that route to neither STOP nor START, so every message reaches the Rate_Limiter. */
const limitedBody: fc.Arbitrary<string> = languageArb
  .chain(body)
  .map((b) => {
    const { command } = routeCommand(b);
    return command === 'STOP' || command === 'START' ? 'HELP' : b;
  });

function gapArb(windowMs: number): fc.Arbitrary<number> {
  return fc.oneof(
    fc.constant(0),
    fc.integer({ min: 0, max: windowMs }),
    fc.integer({ min: 0, max: 2 * windowMs }),
    fc.constantFrom(windowMs - 1, windowMs, windowMs + 1),
  );
}

const scenario: fc.Arbitrary<Scenario> = fc
  .record({
    number: canonicalNumber,
    perNumberLimit: fc.integer({ min: 1, max: 4 }),
    windowMinutes: fc.oneof(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 1440 })),
    today: dayKeyArb,
    start: timeArb,
  })
  .chain((base) =>
    fc
      .array(
        fc.record({ gap: gapArb(base.windowMinutes * MS_PER_MINUTE), body: limitedBody }),
        { minLength: 1, maxLength: 40 },
      )
      .map((messages): Scenario => ({ ...base, messages })),
  );

function initialState(sc: Scenario): GatewayState {
  return {
    stopList: new Set(),
    allowlist: new Set(),
    rate: new Map(),
    slowDown: new Map(),
    counters: {
      dayKey: sc.today,
      received: 0,
      repliesSent: 0,
      replied: 0,
      partsSent: 0,
      ignored: 0,
      handed: 0,
    },
    settings: {
      allowlistMode: false,
      perNumberLimit: sc.perNumberLimit,
      rateWindowMinutes: sc.windowMinutes,
      dailySendCap: DAILY_SEND_CAP,
      defaultCountryCode: '92',
      ownNumber: null,
    },
  };
}

function decide(msg: InboundMessage, state: GatewayState, today: string): GatewayDecision {
  const step = evaluateInbound(msg, state, { paused: false, today }, routeCommand, false);
  if (step.kind === 'final') return step.decision;
  if (step.kind === 'answer') throw new Error('aiAvailable=false must never ask the Answer_Service');
  return completeReply(step.pending, step.text, state, splitSms);
}

/** Runs the sequence, folding every decision's changes into the state. */
function simulate(sc: Scenario): GatewayDecision[] {
  let state = initialState(sc);
  let t = sc.start;
  return sc.messages.map((m, i) => {
    t += m.gap;
    const msg: InboundMessage = { id: `m${String(i)}`, seq: i, sender: sc.number, body: m.body, receivedAt: t };
    const decision = decide(msg, state, sc.today);
    state = applyChanges(state, decision.changes);
    return decision;
  });
}

const isSlowDown = (d: GatewayDecision): boolean =>
  d.outcome === 'rate-limited' && d.parts.length > 0;

describe('Gateway_Pipeline Slow_Down_Text frequency', () => {
  it('Property 14: Req 5.3, 5.4 — at most one Slow_Down_Text per Rate_Window, sent on the first rejection', () => {
    fc.assert(
      fc.property(scenario, (sc) => {
        const windowMs = sc.windowMinutes * MS_PER_MINUTE;
        const decisions = simulate(sc);
        let lastSlowDown: number | undefined;
        for (const d of decisions) {
          if (d.outcome !== 'rate-limited') {
            expect(d.parts).not.toEqual(splitSms(GATEWAY_TEXTS[d.language].slowDown));
            continue;
          }
          const due = lastSlowDown === undefined || d.receivedAt - lastSlowDown >= windowMs;
          if (due) {
            // Req 5.3: the first rejection in a fresh window gets the Slow_Down_Text.
            expect(d.parts).toEqual(splitSms(GATEWAY_TEXTS[d.language].slowDown));
            expect(joinSms([...d.parts])).toBe(GATEWAY_TEXTS[d.language].slowDown);
            lastSlowDown = d.receivedAt;
          } else {
            // Req 5.4: later rejections in the same window get no Reply_Parts.
            expect(d.parts).toEqual([]);
          }
        }
        const times = decisions.filter(isSlowDown).map((d) => d.receivedAt);
        for (let i = 1; i < times.length; i += 1) {
          expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(windowMs);
        }
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });

  it('Req 5.3, 5.4 — a burst of 4 HELPs with limit 1 gives one reply, one Slow_Down_Text, then silence', () => {
    const sc: Scenario = {
      number: '923001234567' as CanonicalNumber,
      perNumberLimit: 1,
      windowMinutes: 10,
      today: '2026-01-01',
      start: 1_767_225_600_000,
      messages: [0, 1000, 1000, 1000].map((gap) => ({ gap, body: 'HELP' })),
    };
    const outcomes = simulate(sc).map((d) => [d.outcome, d.parts.length > 0]);
    expect(outcomes).toEqual([
      ['replied', true],
      ['rate-limited', true],
      ['rate-limited', false],
      ['rate-limited', false],
    ]);
  });
});
