// Feature: necromancer-sms-gateway, Property 15: Early exits leave the limiter and counters untouched
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ALIAS_TABLE } from './aliases.js';
import {
  GATEWAY_PBT_OPTIONS,
  anyBody,
  automatedAddress,
  canonicalNumber,
  dayKeyArb,
  formattingOf,
  gatewayState,
  stopAliasBody,
  timeArb,
} from './gateway.arbitraries.js';
import { applyChanges, evaluateInbound } from './gateway.pipeline.js';
import { normalizeSender } from './gateway.number.js';
import type {
  CanonicalNumber,
  GatewayState,
  InboundMessage,
  Outcome,
  PipelineContext,
} from './gateway.types.js';
import { caseMutate } from './router.arbitraries.js';
import { routeCommand } from './router.js';
import type { RoutedCommand } from './router.types.js';

const START_ALIASES: readonly string[] = [...ALIAS_TABLE]
  .filter(([, command]) => command === 'START')
  .map(([alias]) => alias);

const startBody: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(...START_ALIASES).chain(caseMutate), fc.option(anyBody, { nil: undefined }))
  .map(([alias, arg]) => (arg === undefined ? alias : alias + ' ' + arg));

/** Bodies weighted toward STOP and START so every early exit is reached often. */
const bodyArb: fc.Arbitrary<string> = fc.oneof(anyBody, stopAliasBody, startBody);

interface Case {
  readonly state: GatewayState;
  readonly msg: InboundMessage;
  readonly ctx: PipelineContext;
  readonly aiAvailable: boolean;
}

/** A sender that is an Automated_Sender, the Own_Number, or a number drawn from the state's lists. */
function senderArb(state: GatewayState): fc.Arbitrary<string> {
  const cc = state.settings.defaultCountryCode;
  const listed: CanonicalNumber[] = [...state.stopList, ...state.rate.keys()];
  if (state.allowlist !== 'unreadable') listed.push(...state.allowlist);
  const numberArb = listed.length > 0 ? fc.oneof(fc.constantFrom(...listed), canonicalNumber) : canonicalNumber;
  const senders: fc.Arbitrary<string>[] = [
    automatedAddress,
    numberArb.chain((n) => formattingOf(n, cc)).map((f) => f.address),
  ];
  const own = state.settings.ownNumber;
  if (own !== null) senders.push(formattingOf(own, cc).map((f) => f.address));
  return fc.oneof(...senders);
}

const caseArb: fc.Arbitrary<Case> = gatewayState().chain((state) =>
  fc
    .record({
      sender: senderArb(state),
      body: bodyArb,
      receivedAt: timeArb,
      seq: fc.nat(),
      paused: fc.boolean(),
      today: fc.oneof(fc.constant(state.counters.dayKey), dayKeyArb),
      aiAvailable: fc.boolean(),
    })
    .map(
      (r): Case => ({
        state,
        msg: { id: 'm' + String(r.seq), seq: r.seq, sender: r.sender, body: r.body, receivedAt: r.receivedAt },
        ctx: { paused: r.paused, today: r.today },
        aiAvailable: r.aiAvailable,
      }),
    ),
);

const ALWAYS_EARLY: ReadonlySet<Outcome> = new Set<Outcome>([
  'stopped',
  'ignored-stopped',
  'ignored-not-allowed',
  'ignored-automated',
  'ignored-own-number',
  'ignored-paused',
]);

/** Allowlist_Mode blocks the sender: mode on and the number is not listed, or the list is unreadable. */
function gated(state: GatewayState, number: CanonicalNumber): boolean {
  if (!state.settings.allowlistMode) return false;
  return state.allowlist === 'unreadable' || !state.allowlist.has(number);
}

describe('Property 15: Early exits leave the limiter and counters untouched', () => {
  it('Requirements 5.7, 7.5, 4.11: early exits add no rate, slowdown or counters change', () => {
    let early = 0;
    fc.assert(
      fc.property(caseArb, (c) => {
        let routerCalls = 0;
        const route = (input: string): RoutedCommand => {
          routerCalls += 1;
          return routeCommand(input);
        };
        const sender = normalizeSender(c.msg.sender, c.state.settings.defaultCountryCode);
        const step = evaluateInbound(c.msg, c.state, c.ctx, route, c.aiAvailable);

        // A gated START is an early exit; check it from the inputs, not the Outcome.
        const gatedStart =
          !c.ctx.paused &&
          sender.kind === 'phone' &&
          sender.number !== c.state.settings.ownNumber &&
          routeCommand(c.msg.body).command === 'START' &&
          gated(c.state, sender.number);

        if (step.kind !== 'final') {
          expect(gatedStart).toBe(false);
          return;
        }
        const { decision } = step;
        const isEarly = ALWAYS_EARLY.has(decision.outcome) || gatedStart;
        if (!isEarly) return;
        early += 1;
        if (gatedStart) expect(decision.outcome).toBe('started');

        // A final step never reaches the Answer_Service, and sends nothing.
        expect(decision.parts).toEqual([]);
        for (const change of decision.changes) {
          expect(['rate-record', 'slowdown-record', 'counters']).not.toContain(change.type);
        }
        const next = applyChanges(c.state, decision.changes);
        expect(next.rate).toBe(c.state.rate);
        expect(next.slowDown).toBe(c.state.slowDown);
        expect(next.counters).toBe(c.state.counters);

        if (decision.outcome === 'ignored-automated' || decision.outcome === 'ignored-own-number') {
          expect(decision.changes).toEqual([]);
          expect(routerCalls).toBe(0);
        }
      }),
      GATEWAY_PBT_OPTIONS,
    );
    expect(early).toBeGreaterThan(0);
  });
});
