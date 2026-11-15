import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { createMockClient, type MockStep } from './ai.mock.js';
import { AI_ERROR_KINDS, AiError } from './ai.types.js';
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
  sendReport,
  stopAliasBody,
  timeArb,
} from './gateway.arbitraries.js';
import {
  applyChanges,
  finalizeSend,
  runGatewayPipeline,
  type PipelineDeps,
} from './gateway.pipeline.js';
import {
  OUTCOMES,
  type GatewayState,
  type InboundMessage,
  type SendReport,
} from './gateway.types.js';

const MAX_PARTS = 4;

type Script = 'text' | 'error' | 'hang' | 'throw';
type StartTimer = NonNullable<PipelineDeps['startTimer']>;

/** Fires the backstop at once, so a hanging client never makes the test wait 25 s. */
const fireNow: StartTimer = (_ms, fire) => {
  fire();
  return () => undefined;
};
/** Never fires; the answer always settles first. */
const fireNever: StartTimer = () => () => undefined;

/** A Gateway_State whose country code makes the address a Phone_Number, the Own_Number or an Automated_Sender. */
const scenario: fc.Arbitrary<{ state: GatewayState; address: string }> = countryCode.chain((cc) =>
  fc.oneof(canonicalNumberIn(cc), canonicalNumber).chain((number) =>
    fc
      .tuple(
        gatewayState([number]),
        fc.oneof(formattingOf(number, cc).map((f) => f.address), automatedAddress),
        fc.boolean(),
      )
      .map(([s, address, own]) => ({
        address,
        state: {
          ...s,
          settings: { ...s.settings, defaultCountryCode: cc, ownNumber: own ? number : s.settings.ownNumber },
        },
      })),
  ),
);

const mockStep = (script: Script, text: string, kind: AiError['kind']): MockStep => {
  switch (script) {
    case 'text':
      return { text };
    case 'error':
      return { error: new AiError(kind) };
    case 'hang':
      return { hang: true };
    case 'throw':
      return { throws: new Error('client threw') };
  }
};

interface DepsInput {
  readonly script: Script;
  readonly text: string;
  readonly errorKind: AiError['kind'];
  readonly spyThrows: boolean;
  readonly noKey: boolean;
  readonly immediate: boolean;
  readonly now: number;
}

const depsInput: fc.Arbitrary<DepsInput> = fc.record({
  script: fc.constantFrom<Script>('text', 'error', 'hang', 'throw'),
  text: fc.oneof(fc.string({ maxLength: 400 }), fc.constant('A short kind answer.')),
  errorKind: fc.constantFrom(...AI_ERROR_KINDS),
  spyThrows: fc.boolean(),
  noKey: fc.boolean(),
  immediate: fc.boolean(),
  now: timeArb,
});

/**
 * Mock_Client scripted with text, error, hang or throw; when `spyThrows`, the
 * answerQuestion and checkScam spies throw synchronously instead. A hanging
 * script always gets the immediate timer.
 */
function buildDeps(d: DepsInput): PipelineDeps {
  const answer: AnswerDeps = {
    client: createMockClient([mockStep(d.script, d.text, d.errorKind)]),
    cache: createMemoryCache(),
    clock: () => d.now,
    timeoutMs: 1,
  };
  const startTimer = d.script === 'hang' || d.immediate ? fireNow : fireNever;
  const base: PipelineDeps = { answer: d.noKey ? null : answer, startTimer };
  if (!d.spyThrows) return base;
  const thrower = (): never => {
    throw new Error('answer service threw');
  };
  return {
    ...base,
    answerQuestion: vi.fn<NonNullable<PipelineDeps['answerQuestion']>>(thrower),
    checkScam: vi.fn<NonNullable<PipelineDeps['checkScam']>>(thrower),
  };
}

const bodyArb: fc.Arbitrary<string> = fc.oneof(
  anyBody,
  stopAliasBody,
  fc.constantFrom('What is the weather today?', 'SCAM you won a prize', 'START', 'HELP'),
);

/** One matching SendReport for each part count 1..4. */
const reportsByCount: fc.Arbitrary<readonly SendReport[]> = fc.tuple(
  sendReport(1),
  sendReport(2),
  sendReport(3),
  sendReport(4),
);

describe('gateway.pipeline outcome invariant', () => {
  // Feature: necromancer-sms-gateway, Property 21: Exactly one valid Outcome
  it('records exactly one valid Outcome for every message, state and Mock_Client script (Req 7.4)', async () => {
    /** **Validates: Requirements 7.4** */
    await fc.assert(
      fc.asyncProperty(
        scenario,
        bodyArb,
        fc.boolean(),
        dayKeyArb,
        timeArb,
        depsInput,
        reportsByCount,
        sendReport(),
        async (sc, body, paused, today, receivedAt, d, reports, anyReport) => {
          const msg: InboundMessage = { id: 'm1', seq: 1, sender: sc.address, body, receivedAt };
          const run = runGatewayPipeline(msg, sc.state, { paused, today }, buildDeps(d));
          await expect(run).resolves.toBeDefined();
          const decision = await run;

          expect(OUTCOMES).toContain(decision.outcome);
          expect(decision.parts.length).toBeGreaterThanOrEqual(0);
          expect(decision.parts.length).toBeLessThanOrEqual(MAX_PARTS);

          const n = decision.parts.length;
          const report = n === 0 ? null : (reports[n - 1] ?? null);
          const counters = applyChanges(sc.state, decision.changes).counters;
          const final = finalizeSend(decision, report, counters, today);
          expect(OUTCOMES).toContain(final.outcome);

          const anyFinal = finalizeSend(decision, anyReport, counters, today);
          expect(OUTCOMES).toContain(anyFinal.outcome);
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
