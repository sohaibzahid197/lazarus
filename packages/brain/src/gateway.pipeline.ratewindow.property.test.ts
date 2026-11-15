// Feature: necromancer-sms-gateway, Property 12: At most Per_Number_Limit accepted per window
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
import { applyChanges, runGatewayPipeline, type PipelineDeps } from './gateway.pipeline.js';
import type { CanonicalNumber, GatewayDecision, GatewayState, InboundMessage } from './gateway.types.js';
import { routeCommand } from './router.js';

const MS_PER_MINUTE = 60_000;
/** Large cap: 40 messages × at most 4 parts never reach it, so the cap never binds. */
const DAILY_SEND_CAP = 2000;

/** No readable key, and a timer that never fires, so the run is deterministic and offline. */
const DEPS: PipelineDeps = { answer: null, startTimer: () => () => undefined };

interface Scenario {
  readonly number: CanonicalNumber;
  readonly perNumberLimit: number;
  readonly windowMinutes: number;
  readonly today: string;
  readonly start: number;
  readonly messages: readonly { readonly gap: number; readonly body: string }[];
}

/** Bodies that route to neither STOP nor START, so every message reaches the Rate_Limiter. */
const limitedBody: fc.Arbitrary<string> = languageArb.chain(body).map((b) => {
  const { command } = routeCommand(b);
  return command === 'STOP' || command === 'START' ? 'HELP' : b;
});

/** Gaps that cluster messages inside one window and also hit the window edges. */
function gapArb(windowMs: number): fc.Arbitrary<number> {
  return fc.oneof(
    fc.constant(0),
    fc.integer({ min: 0, max: Math.ceil(windowMs / 4) }),
    fc.integer({ min: 0, max: 2 * windowMs }),
    fc.constantFrom(windowMs - 1, windowMs, windowMs + 1),
  );
}

const scenario: fc.Arbitrary<Scenario> = fc
  .record({
    number: canonicalNumber,
    perNumberLimit: fc.oneof(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 60 })),
    windowMinutes: fc.oneof(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 1440 })),
    today: dayKeyArb,
    start: timeArb,
  })
  .chain((base) =>
    fc
      .array(fc.record({ gap: gapArb(base.windowMinutes * MS_PER_MINUTE), body: limitedBody }), {
        minLength: 1,
        maxLength: 40,
      })
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

/** Runs the sequence through the async pipeline, folding every decision's changes into the state. */
async function simulate(sc: Scenario): Promise<GatewayDecision[]> {
  let state = initialState(sc);
  let t = sc.start;
  const decisions: GatewayDecision[] = [];
  for (const [i, m] of sc.messages.entries()) {
    t += m.gap;
    const msg: InboundMessage = { id: `m${String(i)}`, seq: i, sender: sc.number, body: m.body, receivedAt: t };
    const decision = await runGatewayPipeline(msg, state, { paused: false, today: sc.today }, DEPS);
    state = applyChanges(state, decision.changes);
    decisions.push(decision);
  }
  return decisions;
}

const isAccepted = (d: GatewayDecision): boolean => d.changes.some((c) => c.type === 'rate-record');

describe('Gateway_Pipeline per-window rate invariant', () => {
  it('Property 12: Req 5.5 — at most Per_Number_Limit accepted messages in any Rate_Window', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (sc) => {
        const windowMs = sc.windowMinutes * MS_PER_MINUTE;
        const decisions = await simulate(sc);

        // A message is accepted exactly when it records in the Rate_Limiter.
        for (const d of decisions) {
          expect(isAccepted(d)).toBe(d.outcome !== 'rate-limited');
        }

        const accepted = decisions.filter(isAccepted).map((d) => d.receivedAt);
        // Every window (t − window, t] ending at a receive time.
        for (const d of decisions) {
          const t = d.receivedAt;
          const inWindow = accepted.filter((tau) => tau > t - windowMs && tau <= t).length;
          expect(inWindow).toBeLessThanOrEqual(sc.perNumberLimit);
        }
        // Every half-open window [s, s + window); the worst start points are accepted times.
        for (const s of accepted) {
          const inWindow = accepted.filter((tau) => tau >= s && tau < s + windowMs).length;
          expect(inWindow).toBeLessThanOrEqual(sc.perNumberLimit);
        }
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
