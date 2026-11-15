// Feature: necromancer-sms-gateway, Property 9: Allowlist gate
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GATEWAY_PBT_OPTIONS,
  anyBody,
  dayKeyArb,
  formattedNumber,
  gatewayState,
  timeArb,
} from './gateway.arbitraries.js';
import { evaluateInbound, type EvalStep } from './gateway.pipeline.js';
import type { CanonicalNumber, GatewayState, InboundMessage, PipelineContext } from './gateway.types.js';
import { routeCommand } from './router.js';

interface Case {
  readonly state: GatewayState;
  readonly number: CanonicalNumber;
  readonly msg: InboundMessage;
  readonly ctx: PipelineContext;
  readonly aiAvailable: boolean;
}

/** Puts `number` on or off a readable Allowlist; an unreadable one stays unreadable. */
function withListed(state: GatewayState, number: CanonicalNumber, listed: boolean): GatewayState {
  if (state.allowlist === 'unreadable') return state;
  const allowlist = new Set(state.allowlist);
  if (listed) allowlist.add(number);
  else allowlist.delete(number);
  return { ...state, allowlist };
}

/** A non-STOP, non-START message from a Phone_Number not on the Stop_List and not the Own_Number. */
const caseArb: fc.Arbitrary<Case> = gatewayState().chain((base) =>
  fc
    .record({
      sender: formattedNumber(base.settings.defaultCountryCode),
      listed: fc.boolean(),
      body: anyBody.filter((b) => {
        const command = routeCommand(b).command;
        return command !== 'STOP' && command !== 'START';
      }),
      receivedAt: timeArb,
      today: fc.oneof(fc.constant(base.counters.dayKey), dayKeyArb),
      seq: fc.nat(),
      aiAvailable: fc.boolean(),
    })
    .filter((r) => r.sender.number !== base.settings.ownNumber)
    .map((r): Case => {
      const number = r.sender.number;
      const stopList = new Set(base.stopList);
      stopList.delete(number);
      const state = withListed({ ...base, stopList }, number, r.listed);
      return {
        state,
        number,
        msg: { id: 'm' + String(r.seq), seq: r.seq, sender: r.sender.address, body: r.body, receivedAt: r.receivedAt },
        ctx: { paused: false, today: r.today },
        aiAvailable: r.aiAvailable,
      };
    }),
);

const run = (c: Case, state: GatewayState): EvalStep =>
  evaluateInbound(c.msg, state, c.ctx, routeCommand, c.aiAvailable);

const blocked = (c: Case): boolean =>
  c.state.settings.allowlistMode &&
  (c.state.allowlist === 'unreadable' || !c.state.allowlist.has(c.number));

describe('Property 9: Allowlist gate', () => {
  it('blocks unlisted numbers under Allowlist_Mode and otherwise decides as with the mode off (Requirements 4.1, 4.2, 4.3, 4.9)', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const step = run(c, c.state);
        if (blocked(c)) {
          expect(step.kind).toBe('final');
          if (step.kind !== 'final') return;
          expect(step.decision.outcome).toBe('ignored-not-allowed');
          expect(step.decision.parts).toEqual([]);
          expect(step.decision.changes).toEqual([]);
          return;
        }
        if (step.kind === 'final') {
          expect(step.decision.outcome).not.toBe('ignored-not-allowed');
        }
        const modeOff: GatewayState = {
          ...c.state,
          settings: { ...c.state.settings, allowlistMode: false },
        };
        expect(step).toEqual(run(c, modeOff));
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
