// Feature: necromancer-sms-gateway, Property 16: The Daily_Send_Cap is never exceeded
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
import { applyChanges, completeReply, evaluateInbound, finalizeSend } from './gateway.pipeline.js';
import type {
  CanonicalNumber,
  GatewayDecision,
  GatewayState,
  InboundMessage,
  SendReport,
} from './gateway.types.js';
import { routeCommand } from './router.js';
import { plainLatinWordArb } from './router.arbitraries.js';
import { splitSms } from './sms.js';

/** AI text from one word up to about 700 characters, so splitSms gives 1 to 4 parts. */
const aiTextArb: fc.Arbitrary<string> = fc
  .array(plainLatinWordArb, { minLength: 1, maxLength: 120 })
  .map((words) => words.join(' '));

interface Scenario {
  readonly state: GatewayState;
  readonly today: string;
  readonly aiAvailable: boolean;
  readonly start: number;
  readonly inbound: readonly {
    readonly sender: CanonicalNumber;
    readonly body: string;
    readonly gapMs: number;
    readonly aiText: string;
    readonly releaseRoll: number;
  }[];
}

const scenario: fc.Arbitrary<Scenario> = fc
  .uniqueArray(canonicalNumber, { minLength: 1, maxLength: 6 })
  .chain((pool) =>
    fc.record({
      pool: fc.constant(pool),
      state: gatewayState(pool),
      cap: fc.integer({ min: 1, max: 20 }),
      startHanded: fc.integer({ min: 0, max: 20 }),
      perNumberLimit: fc.integer({ min: 1, max: 60 }),
      allowlistMode: fc.boolean(),
      today: dayKeyArb,
      aiAvailable: fc.boolean(),
      start: timeArb,
      inbound: fc.array(
        fc.record({
          sender: fc.constantFrom(...pool),
          body: anyBody,
          gapMs: fc.integer({ min: 0, max: 120_000 }),
          aiText: aiTextArb,
          releaseRoll: fc.integer({ min: 0, max: 9 }),
        }),
        { minLength: 1, maxLength: 40 },
      ),
    }),
  )
  .map((r): Scenario => {
    const ownNumber =
      r.state.settings.ownNumber !== null && r.pool.includes(r.state.settings.ownNumber)
        ? null
        : r.state.settings.ownNumber;
    const state: GatewayState = {
      ...r.state,
      settings: {
        ...r.state.settings,
        dailySendCap: r.cap,
        perNumberLimit: r.perNumberLimit,
        allowlistMode: r.allowlistMode && r.state.allowlist !== 'unreadable',
        ownNumber,
      },
      counters: { ...r.state.counters, dayKey: r.today, handed: Math.min(r.startHanded, r.cap) },
    };
    return { state, today: r.today, aiAvailable: r.aiAvailable, start: r.start, inbound: r.inbound };
  });

/** A refused or cancelled report for about 1 in 5 decisions with parts; otherwise all parts sent. */
function reportFor(parts: number, roll: number): SendReport {
  if (roll === 0) return { status: 'refused-stopped' };
  if (roll === 1) return { status: 'cancelled' };
  return { status: 'done', results: Array.from({ length: parts }, () => 'sent' as const), attempts: 1 };
}

describe('Property 16: The Daily_Send_Cap is never exceeded', () => {
  it('Requirements 5.8, 5.12: handed never exceeds the Daily_Send_Cap, and at the cap no parts and no Answer_Service', () => {
    fc.assert(
      fc.property(scenario, (sc) => {
        const cap = sc.state.settings.dailySendCap;
        const ctx = { paused: false, today: sc.today };
        let state = sc.state;
        let net = state.counters.handed; // parts handed minus parts released
        let at = sc.start;
        sc.inbound.forEach((m, i) => {
          at += m.gapMs;
          const msg: InboundMessage = { id: `m${String(i)}`, seq: i, sender: m.sender, body: m.body, receivedAt: at };
          const before = state.counters.handed;
          const step = evaluateInbound(msg, state, ctx, routeCommand, sc.aiAvailable);
          let decision: GatewayDecision;
          if (step.kind === 'final') decision = step.decision;
          else if (step.kind === 'reply') decision = completeReply(step.pending, step.text, state, splitSms);
          else decision = completeReply(step.pending, m.aiText, state, splitSms);

          if (decision.outcome === 'send-capped') expect(decision.parts).toEqual([]);
          if (before === cap && decision.command !== 'STOP') {
            // Requirement 5.12: nothing is produced and the Answer_Service is skipped.
            expect(step.kind).not.toBe('answer');
            expect(decision.parts).toEqual([]);
            expect(decision.outcome).not.toBe('replied');
            expect(decision.changes.some((c) => c.type === 'counters')).toBe(false);
          }

          state = applyChanges(state, decision.changes);
          net += decision.parts.length;
          expect(net).toBeLessThanOrEqual(cap);
          expect(state.counters.handed).toBe(net);
          expect(state.counters.handed).toBeLessThanOrEqual(cap);

          const report = decision.parts.length > 0 ? reportFor(decision.parts.length, m.releaseRoll) : null;
          const final = finalizeSend(decision, report, state.counters, sc.today);
          state = applyChanges(state, final.changes);
          if (report !== null && report.status !== 'done') net -= decision.parts.length;
          expect(state.counters.handed).toBe(net);
          expect(state.counters.handed).toBeLessThanOrEqual(cap);
        });
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
