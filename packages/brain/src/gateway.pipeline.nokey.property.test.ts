// Property test for the Gateway_Pipeline no-key path (task 9.12).
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMockClient } from './ai.mock.js';
import { createMemoryCache } from './answer.cache.js';
import { FIXED_TEXTS } from './answer.texts.js';
import type { AnswerDeps } from './answer.types.js';
import {
  GATEWAY_PBT_OPTIONS,
  anyBody,
  automatedAddress,
  body,
  canonicalNumber,
  canonicalNumberIn,
  countryCode,
  dayKeyArb,
  formattingOf,
  gatewayState,
  languageArb,
  stopAliasBody,
  timeArb,
} from './gateway.arbitraries.js';
import { runGatewayPipeline, type PipelineDeps } from './gateway.pipeline.js';
import type { GatewayState, InboundMessage, PipelineContext } from './gateway.types.js';
import { routeCommand } from './router.js';
import type { Language, RoutedCommand } from './router.types.js';
import { splitSms } from './sms.js';

/** Never fires; the spies always settle first. */
const noTimer: NonNullable<PipelineDeps['startTimer']> = () => () => undefined;

/** A state whose country code makes the address a Phone_Number, the Own_Number or an Automated_Sender. */
const scenario: fc.Arbitrary<{ state: GatewayState; address: string }> = countryCode.chain((cc) =>
  fc.oneof(canonicalNumberIn(cc), canonicalNumber).chain((number) =>
    fc
      .tuple(
        gatewayState([number]),
        fc.oneof(
          { arbitrary: formattingOf(number, cc).map((f) => f.address), weight: 4 },
          { arbitrary: automatedAddress, weight: 1 },
        ),
        fc.boolean(),
      )
      .map(([s, address, own]) => ({
        address,
        state: {
          ...s,
          settings: {
            ...s.settings,
            defaultCountryCode: cc,
            ownNumber: own ? number : s.settings.ownNumber,
          },
        },
      })),
  ),
);

const bodyArb: fc.Arbitrary<string> = fc.oneof(
  languageArb.chain(body),
  anyBody,
  stopAliasBody,
  fc.constantFrom('', ' ', '\n'),
);

/** QUESTION with text or SCAM with an argument: the commands that need the Answer_Service. */
const needsAi = (r: RoutedCommand): boolean =>
  (r.command === 'QUESTION' && /\S/.test(r.argument)) ||
  (r.command === 'SCAM' && !r.argumentMissing);

interface Spied {
  readonly deps: PipelineDeps;
  readonly calls: { question: number; scam: number };
}

/** Deps whose spies return the Try_Later_Text, so a keyed reply has the same parts as a no-key reply. */
function spiedDeps(answer: AnswerDeps | null): Spied {
  const calls = { question: 0, scam: 0 };
  const tryLater = (language: Language | undefined): Promise<string> =>
    Promise.resolve(FIXED_TEXTS[language ?? 'en'].tryLater);
  const deps: PipelineDeps = {
    answer,
    startTimer: noTimer,
    answerQuestion: (_d, _argument, language) => {
      calls.question += 1;
      return tryLater(language);
    },
    checkScam: (_d, _argument, language) => {
      calls.scam += 1;
      return tryLater(language);
    },
  };
  return { deps, calls };
}

describe('Gateway_Pipeline no-key path', () => {
  // Feature: necromancer-sms-gateway, Property 34: No key means busy reply only for AI commands
  // **Validates: Requirements 16.18**
  it('Req 16.18: with no key only AI commands change, to the Try_Later_Text, with no AI calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenario,
        timeArb,
        bodyArb,
        fc.boolean(),
        fc.option(dayKeyArb, { nil: undefined }),
        async ({ state, address }, receivedAt, text, paused, otherDay) => {
          const ctx: PipelineContext = { paused, today: otherDay ?? state.counters.dayKey };
          const msg: InboundMessage = { id: 'm1', seq: 1, sender: address, body: text, receivedAt };
          const client = createMockClient([{ text: 'unused' }]);
          const answer: AnswerDeps = { client, cache: createMemoryCache(), clock: () => receivedAt };
          const keyed = spiedDeps(answer);
          const noKey = spiedDeps(null);

          const withKey = await runGatewayPipeline(msg, state, ctx, keyed.deps);
          const withoutKey = await runGatewayPipeline(msg, state, ctx, noKey.deps);

          // No key: the Answer_Service and the Mock_Client are never called.
          expect(noKey.calls).toEqual({ question: 0, scam: 0 });
          expect(client.calls).toHaveLength(0);
          // Every decision (outcome, parts, changes) equals the keyed run.
          expect(withoutKey).toEqual(withKey);

          const routed = routeCommand(text);
          const keyedCalls = keyed.calls.question + keyed.calls.scam;
          if (keyedCalls > 0) {
            // Only an AI command reaches the Answer_Service, and then at most once.
            expect(needsAi(routed)).toBe(true);
            expect(keyedCalls).toBe(1);
          }
          if (needsAi(routed) && withoutKey.command === routed.command && withoutKey.outcome === 'replied') {
            expect(withoutKey.parts).toEqual(splitSms(FIXED_TEXTS[routed.language].tryLater));
            expect(keyedCalls).toBe(1);
          }
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
