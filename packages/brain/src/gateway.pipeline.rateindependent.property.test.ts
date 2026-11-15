// Feature: necromancer-sms-gateway, Property 13: Rate limiting is independent per number
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GATEWAY_PBT_OPTIONS,
  anyBody,
  canonicalNumber,
  dayKeyArb,
  gatewayState,
  timeArb,
} from './gateway.arbitraries.js';
import { applyChanges, runGatewayPipeline } from './gateway.pipeline.js';
import type { CanonicalNumber, GatewayState, InboundMessage } from './gateway.types.js';

const MS_PER_MINUTE = 60_000;

/** 40 messages × at most 4 parts stay far below this cap, so it never binds. */
const DAILY_SEND_CAP = 2000;

interface Scenario {
  /** pool[0] is number A; the rest are the other senders. */
  readonly pool: readonly CanonicalNumber[];
  readonly state: GatewayState;
  readonly today: string;
  /** The interleaved timeline; receive times are fixed here and shared by both runs. */
  readonly messages: readonly InboundMessage[];
}

/** Gaps that land inside, on and just past the Rate_Window edge. */
function gapArb(windowMs: number): fc.Arbitrary<number> {
  return fc.oneof(
    fc.constant(0),
    fc.integer({ min: 0, max: windowMs }),
    fc.integer({ min: 0, max: 2 * windowMs }),
    fc.constantFrom(windowMs - 1, windowMs, windowMs + 1),
  );
}

const scenario: fc.Arbitrary<Scenario> = fc
  .uniqueArray(canonicalNumber, { minLength: 2, maxLength: 3 })
  .chain((pool) =>
    fc
      .record({
        state: gatewayState(pool),
        perNumberLimit: fc.integer({ min: 1, max: 4 }),
        windowMinutes: fc.oneof(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 1440 })),
        today: dayKeyArb,
        start: timeArb,
      })
      .chain((base) =>
        fc
          .array(
            fc.record({
              sender: fc.constantFrom(...pool),
              gap: gapArb(base.windowMinutes * MS_PER_MINUTE),
              body: anyBody,
            }),
            { minLength: 1, maxLength: 40 },
          )
          .map((raw): Scenario => {
            let at = base.start;
            const messages = raw.map((m, i): InboundMessage => {
              at += m.gap;
              return { id: `m${String(i)}`, seq: i, sender: m.sender, body: m.body, receivedAt: at };
            });
            const state: GatewayState = {
              ...base.state,
              settings: {
                ...base.state.settings,
                perNumberLimit: base.perNumberLimit,
                rateWindowMinutes: base.windowMinutes,
                dailySendCap: DAILY_SEND_CAP,
                ownNumber: null,
              },
              counters: { ...base.state.counters, dayKey: base.today, handed: 0 },
            };
            return { pool, state, today: base.today, messages };
          }),
      ),
  );

interface AOutcome {
  readonly id: string;
  readonly outcome: string;
  readonly rateLimited: boolean;
  readonly parts: readonly string[];
}

/** Runs `messages` in order from `initial` and returns the outcomes of `number`'s messages. */
async function outcomesFor(
  messages: readonly InboundMessage[],
  initial: GatewayState,
  today: string,
  number: CanonicalNumber,
): Promise<AOutcome[]> {
  const ctx = { paused: false, today };
  let state = initial;
  const out: AOutcome[] = [];
  for (const msg of messages) {
    const decision = await runGatewayPipeline(msg, state, ctx, { answer: null });
    state = applyChanges(state, decision.changes);
    if (msg.sender === number) {
      out.push({
        id: msg.id,
        outcome: decision.outcome,
        rateLimited: decision.outcome === 'rate-limited',
        parts: decision.parts,
      });
    }
  }
  return out;
}

describe('Gateway_Pipeline per-number rate limiting', () => {
  it('Property 13: Req 5.6 — A\'s rate decisions are the same interleaved with other numbers as alone', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (sc) => {
        const a = sc.pool[0]!;
        const interleaved = await outcomesFor(sc.messages, sc.state, sc.today, a);
        const alone = await outcomesFor(
          sc.messages.filter((m) => m.sender === a),
          sc.state,
          sc.today,
          a,
        );
        expect(interleaved).toEqual(alone);
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });

  it('Req 5.6 — B using up its limit does not rate-limit A', async () => {
    const a = '+923001234567' as CanonicalNumber;
    const b = '+923007654321' as CanonicalNumber;
    const state: GatewayState = {
      stopList: new Set(),
      allowlist: new Set(),
      rate: new Map(),
      slowDown: new Map(),
      counters: {
        dayKey: '2026-01-01',
        received: 0,
        repliesSent: 0,
        replied: 0,
        partsSent: 0,
        ignored: 0,
        handed: 0,
      },
      settings: {
        allowlistMode: false,
        perNumberLimit: 1,
        rateWindowMinutes: 10,
        dailySendCap: DAILY_SEND_CAP,
        defaultCountryCode: '92',
        ownNumber: null,
      },
    };
    const t0 = 1_767_225_600_000;
    const messages: InboundMessage[] = [b, b, a, b, a].map((sender, i) => ({
      id: `m${String(i)}`,
      seq: i,
      sender,
      body: 'HELP',
      receivedAt: t0 + i * 1000,
    }));
    const outcomes = (await outcomesFor(messages, state, '2026-01-01', a)).map((o) => o.outcome);
    expect(outcomes).toEqual(['replied', 'rate-limited']);
  });
});
