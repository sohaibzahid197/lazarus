import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { createMockClient } from './ai.mock.js';
import { createMemoryCache } from './answer.cache.js';
import type { AnswerDeps } from './answer.types.js';
import {
  GATEWAY_PBT_OPTIONS,
  anyBody,
  automatedAddress,
  canonicalNumber,
  canonicalNumberIn,
  countryCode,
  dayKeyArb,
  formattingOf,
  gatewayState,
  stopAliasBody,
  timeArb,
} from './gateway.arbitraries.js';
import { normalizeSender } from './gateway.number.js';
import { evaluateInbound, runGatewayPipeline, type PipelineDeps } from './gateway.pipeline.js';
import type { CanonicalNumber, GatewayDecision, GatewayState, InboundMessage } from './gateway.types.js';
import { routeCommand } from './router.js';

type SenderKind = 'phone' | 'own' | 'automated';

interface Scenario {
  readonly kind: SenderKind;
  /** The sender's Canonical_Number; null for an Automated_Sender. */
  readonly number: CanonicalNumber | null;
  readonly address: string;
  readonly state: GatewayState;
}

/**
 * A Gateway_State with the Default_Country_Code set so the address normalizes
 * as intended: another Phone_Number, the Own_Number, or an Automated_Sender.
 */
const scenario: fc.Arbitrary<Scenario> = fc
  .tuple(countryCode, fc.constantFrom<SenderKind>('phone', 'own', 'automated'))
  .chain(([cc, kind]) =>
    fc.oneof(canonicalNumberIn(cc), canonicalNumber).chain((number) =>
      fc
        .tuple(
          gatewayState([number]),
          kind === 'automated'
            ? automatedAddress.filter((a) => normalizeSender(a, cc).kind === 'automated')
            : formattingOf(number, cc).map((f) => f.address),
        )
        .map(([s, address]): Scenario => {
          const ownNumber =
            kind === 'own' ? number : s.settings.ownNumber === number ? null : s.settings.ownNumber;
          return {
            kind,
            number: kind === 'automated' ? null : number,
            address,
            state: { ...s, settings: { ...s.settings, defaultCountryCode: cc, ownNumber } },
          };
        }),
    ),
  );

const pausedBody: fc.Arbitrary<string> = fc.oneof(anyBody, stopAliasBody);

/** Checks the decision against Property 23 and Requirement 9.11 for STOP. */
function expectPausedDecision(decision: GatewayDecision, sc: Scenario, body: string): void {
  expect(decision.parts).toEqual([]);
  const isStop = sc.kind === 'phone' && routeCommand(body).command === 'STOP';
  if (isStop) {
    expect(decision.outcome).toBe('stopped');
    expect(decision.changes).toEqual([{ type: 'stop-add', number: sc.number }]);
  } else {
    expect(decision.outcome).toBe('ignored-paused');
    expect(decision.changes).toEqual([]);
  }
}

describe('gateway.pipeline while paused', () => {
  // Feature: necromancer-sms-gateway, Property 23: Paused gateway answers nothing
  it('answers nothing and changes nothing except a STOP while paused (Requirements 9.10)', () => {
    /** **Validates: Requirements 9.10** */
    fc.assert(
      fc.property(
        scenario,
        pausedBody,
        fc.boolean(),
        dayKeyArb,
        timeArb,
        (sc, body, aiAvailable, today, receivedAt) => {
          const msg: InboundMessage = { id: 'm1', seq: 1, sender: sc.address, body, receivedAt };
          const step = evaluateInbound(msg, sc.state, { paused: true, today }, routeCommand, aiAvailable);
          expect(step.kind).toBe('final');
          if (step.kind !== 'final') return;
          expectPausedDecision(step.decision, sc, body);
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
  });

  // Feature: necromancer-sms-gateway, Property 23: Paused gateway answers nothing
  it('never calls the Answer_Service while paused (Requirements 9.10)', async () => {
    /** **Validates: Requirements 9.10** */
    await fc.assert(
      fc.asyncProperty(scenario, pausedBody, dayKeyArb, timeArb, async (sc, body, today, receivedAt) => {
        const answerQuestion = vi.fn<NonNullable<PipelineDeps['answerQuestion']>>(() =>
          Promise.resolve('answer'),
        );
        const checkScam = vi.fn<NonNullable<PipelineDeps['checkScam']>>(() =>
          Promise.resolve('scam'),
        );
        const answer: AnswerDeps = {
          client: createMockClient([{ text: 'unused' }]),
          cache: createMemoryCache(),
          clock: () => receivedAt,
        };
        const deps: PipelineDeps = { answer, answerQuestion, checkScam };
        const msg: InboundMessage = { id: 'm1', seq: 1, sender: sc.address, body, receivedAt };
        const decision = await runGatewayPipeline(msg, sc.state, { paused: true, today }, deps);
        expectPausedDecision(decision, sc, body);
        expect(answerQuestion).not.toHaveBeenCalled();
        expect(checkScam).not.toHaveBeenCalled();
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
