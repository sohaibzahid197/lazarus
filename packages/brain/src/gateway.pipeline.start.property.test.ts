// Feature: necromancer-sms-gateway, Property 8: START clears the Stop_List and replies only with Welcome_Back_Text
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ALIAS_TABLE } from './aliases.js';
import {
  GATEWAY_PBT_OPTIONS,
  canonicalNumber,
  dayKeyArb,
  gatewayState,
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
import { caseMutate, plainLatinWordArb, urduCharArb } from './router.arbitraries.js';
import { joinSms, splitSms } from './sms.js';

const START_ALIASES: readonly string[] = [...ALIAS_TABLE]
  .filter(([, command]) => command === 'START')
  .map(([alias]) => alias);

const wordArb = fc.oneof(
  plainLatinWordArb,
  fc.string({ unit: urduCharArb, minLength: 1, maxLength: 6 }),
);

/** A START alias in any letter case, with an optional argument. */
const startBody: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...START_ALIASES).chain(caseMutate),
    fc.option(fc.array(wordArb, { minLength: 1, maxLength: 5 }), { nil: undefined }),
  )
  .map(([alias, words]) => (words === undefined ? alias : `${alias} ${words.join(' ')}`));

interface Scenario {
  readonly number: CanonicalNumber;
  readonly state: GatewayState;
  readonly msg: InboundMessage;
  readonly today: string;
}

const scenario: fc.Arbitrary<Scenario> = canonicalNumber.chain((number) =>
  fc
    .record({
      state: gatewayState([number]),
      body: startBody,
      receivedAt: timeArb,
      todayOther: dayKeyArb,
      sameDay: fc.boolean(),
    })
    .map(({ state, body, receivedAt, todayOther, sameDay }) => {
      // The sender is never the Own_Number in this property.
      const ownNumber = state.settings.ownNumber === number ? null : state.settings.ownNumber;
      const s: GatewayState = { ...state, settings: { ...state.settings, ownNumber } };
      const today = sameDay ? s.counters.dayKey : todayOther;
      const msg: InboundMessage = { id: 'm1', seq: 1, sender: number, body, receivedAt };
      return { number, state: s, msg, today };
    }),
);

function decide(sc: Scenario): GatewayDecision {
  const step = evaluateInbound(
    sc.msg,
    sc.state,
    { paused: false, today: sc.today },
    routeCommand,
    true,
  );
  if (step.kind === 'final') return step.decision;
  if (step.kind === 'answer') throw new Error('START must never call the Answer_Service');
  return completeReply(step.pending, step.text, sc.state, splitSms);
}

function blockedByAllowlist(sc: Scenario): boolean {
  const { allowlistMode } = sc.state.settings;
  const list = sc.state.allowlist;
  return allowlistMode && (list === 'unreadable' || !list.has(sc.number));
}

describe('Property 8: START clears the Stop_List and replies only with Welcome_Back_Text', () => {
  it('Requirements 3.4, 3.5, 3.13, 4.8, 4.11: START removes the number and replies only with Welcome_Back_Text', () => {
    fc.assert(
      fc.property(scenario, (sc) => {
        const wasStopped = sc.state.stopList.has(sc.number);
        const decision = decide(sc);
        const after = applyChanges(sc.state, decision.changes);

        expect(decision.command).toBe('START');
        // Stop_List: the number is gone, every other entry is unchanged.
        expect(after.stopList.has(sc.number)).toBe(false);
        const othersBefore = [...sc.state.stopList].filter((n) => n !== sc.number).sort();
        expect([...after.stopList].sort()).toEqual(othersBefore);
        const removes = decision.changes.filter((c) => c.type === 'stop-remove');
        expect(removes).toEqual(wasStopped ? [{ type: 'stop-remove', number: sc.number }] : []);
        expect(decision.changes.some((c) => c.type === 'stop-add')).toBe(false);

        expect(['started', 'rate-limited', 'send-capped']).toContain(decision.outcome);
        const texts = GATEWAY_TEXTS[decision.language];
        if (decision.outcome === 'started' && decision.parts.length > 0) {
          expect(joinSms([...decision.parts])).toBe(texts.welcomeBack);
          expect(decision.parts).toEqual(splitSms(texts.welcomeBack));
        }
        if (decision.outcome === 'rate-limited' && decision.parts.length > 0) {
          expect(decision.parts).toEqual(splitSms(texts.slowDown));
        }
        if (decision.outcome === 'send-capped') expect(decision.parts).toEqual([]);

        if (blockedByAllowlist(sc)) {
          // Allowlist_Mode on, number not listed or Allowlist unreadable (4.8, 4.11).
          expect(decision.outcome).toBe('started');
          expect(decision.parts).toEqual([]);
          expect(decision.changes).toEqual(removes);
          expect(after.rate).toEqual(sc.state.rate);
          expect(after.slowDown).toEqual(sc.state.slowDown);
          expect(after.counters).toEqual(sc.state.counters);
        }
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
