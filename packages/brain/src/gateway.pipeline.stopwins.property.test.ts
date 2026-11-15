// Feature: necromancer-sms-gateway, Property 6: STOP always wins
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMockClient, type MockClient } from './ai.mock.js';
import { ALIAS_TABLE } from './aliases.js';
import { createMemoryCache } from './answer.cache.js';
import { answerQuestion, checkScam } from './answer.service.js';
import {
  GATEWAY_PBT_OPTIONS,
  anyBody,
  body,
  canonicalNumber,
  formattingOf,
  gatewayState,
  languageArb,
  stopAliasBody,
  timeArb,
} from './gateway.arbitraries.js';
import {
  applyChanges,
  finalizeSend,
  runGatewayPipeline,
  type PipelineDeps,
} from './gateway.pipeline.js';
import type {
  CanonicalNumber,
  GatewayDecision,
  GatewayState,
  InboundMessage,
} from './gateway.types.js';
import { routeCommand } from './router.js';
import { caseMutate } from './router.arbitraries.js';

const aliasesOf = (command: string): string[] =>
  [...ALIAS_TABLE].filter(([, c]) => c === command).map(([alias]) => alias);

/** An alias of `command` in any letter case, with an optional argument from `tail`. */
function aliasBody(command: string, tail: fc.Arbitrary<string>): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.constantFrom(...aliasesOf(command)).chain(caseMutate),
      fc.option(tail, { nil: undefined }),
    )
    .map(([alias, arg]) => (arg === undefined ? alias : `${alias} ${arg}`));
}

const freeArg = languageArb.chain(body);

/** Bodies drawn from STOP, START, HELP, SCAM and every other form in all three Languages. */
const sequenceBody: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: stopAliasBody, weight: 3 },
  { arbitrary: aliasBody('START', freeArg), weight: 2 },
  { arbitrary: aliasBody('HELP', freeArg), weight: 1 },
  { arbitrary: aliasBody('SCAM', freeArg), weight: 2 },
  { arbitrary: anyBody, weight: 4 },
);

interface Step {
  readonly body: string;
  readonly address: string;
  readonly gapMs: number;
  readonly paused: boolean;
}

interface Scenario {
  readonly number: CanonicalNumber;
  readonly state: GatewayState;
  readonly steps: readonly Step[];
  readonly start: number;
  readonly withKey: boolean;
  readonly sameDay: boolean;
}

const scenario: fc.Arbitrary<Scenario> = canonicalNumber.chain((number) =>
  gatewayState([number]).chain((raw) => {
    // The sender is never the Own_Number in this property.
    const ownNumber = raw.settings.ownNumber === number ? null : raw.settings.ownNumber;
    const state: GatewayState = { ...raw, settings: { ...raw.settings, ownNumber } };
    const step: fc.Arbitrary<Step> = fc.record({
      body: sequenceBody,
      address: formattingOf(number, state.settings.defaultCountryCode).map((f) => f.address),
      gapMs: fc.integer({ min: 0, max: 10 * 60_000 }),
      paused: fc.boolean(),
    });
    return fc.record({
      number: fc.constant(number),
      state: fc.constant(state),
      steps: fc.array(step, { minLength: 1, maxLength: 12 }),
      start: timeArb,
      withKey: fc.boolean(),
      sameDay: fc.boolean(),
    });
  }),
);

interface Spies {
  readonly deps: PipelineDeps;
  readonly client: MockClient;
  readonly count: () => number;
}

function spies(withKey: boolean, clockAt: () => number): Spies {
  let calls = 0;
  const client = createMockClient([{ text: 'A short answer.' }]);
  const deps: PipelineDeps = {
    answer: withKey ? { client, cache: createMemoryCache(), clock: clockAt } : null,
    answerQuestion: (...args) => {
      calls += 1;
      return answerQuestion(...args);
    },
    checkScam: (...args) => {
      calls += 1;
      return checkScam(...args);
    },
    // No real timers: the backstop never fires.
    startTimer: () => () => undefined,
  };
  return { deps, client, count: () => calls + client.calls.length };
}

/** Folds the decision and its send finalization into the state (all parts sent). */
function fold(state: GatewayState, decision: GatewayDecision, today: string): GatewayState {
  const afterDecision = applyChanges(state, decision.changes);
  const report =
    decision.parts.length === 0
      ? null
      : {
          status: 'done' as const,
          results: decision.parts.map(() => 'sent' as const),
          attempts: 1 as const,
        };
  const final = finalizeSend(decision, report, afterDecision.counters, today);
  return applyChanges(afterDecision, final.changes);
}

describe('Property 6: STOP always wins', () => {
  it('Req 3.10, 3.3, 3.1: no Reply_Parts for STOP or any message after it until START', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (sc) => {
        let state = sc.state;
        let now = sc.start;
        const today = sc.sameDay ? state.counters.dayKey : '2099-01-01';
        const spy = spies(sc.withKey, () => now);
        // Model: stopped since the last STOP (or already listed) and no START since.
        let stopped = state.stopList.has(sc.number);
        for (const [i, step] of sc.steps.entries()) {
          now += step.gapMs;
          const msg: InboundMessage = {
            id: `m${String(i)}`,
            seq: i,
            sender: step.address,
            body: step.body,
            receivedAt: now,
          };
          const command = routeCommand(step.body).command;
          const before = spy.count();
          const decision = await runGatewayPipeline(
            msg,
            state,
            { paused: step.paused, today },
            spy.deps,
          );
          if (command === 'STOP') {
            expect(decision.outcome).toBe('stopped');
            expect(decision.parts).toEqual([]);
            expect(spy.count()).toBe(before);
            stopped = true;
          } else if (command === 'START') {
            stopped = false;
          } else if (stopped) {
            expect(decision.parts).toEqual([]);
            // Requirement 9.10: a paused gateway reports ignored-paused first.
            expect(decision.outcome).toBe(step.paused ? 'ignored-paused' : 'ignored-stopped');
            expect(spy.count()).toBe(before);
          }
          state = fold(state, decision, today);
          if (command === 'STOP') {
            expect(state.stopList.has(sc.number)).toBe(true);
            expect([...state.stopList].filter((n) => n === sc.number)).toHaveLength(1);
          }
        }
      }),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
