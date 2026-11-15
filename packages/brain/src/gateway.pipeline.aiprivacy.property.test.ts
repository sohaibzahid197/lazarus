// Property test for the Gateway_Pipeline: the AI never sees sender data (task 9.5).
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMockClient } from './ai.mock.js';
import { createMemoryCache } from './answer.cache.js';
import type { AnswerDeps } from './answer.types.js';
import {
  GATEWAY_PBT_OPTIONS,
  body,
  countryCode,
  formattedNumber,
  languageArb,
  timeArb,
} from './gateway.arbitraries.js';
import { zeroCounters } from './gateway.counters.js';
import { maskNumber, maskSender } from './gateway.number.js';
import { runGatewayPipeline, type PipelineDeps } from './gateway.pipeline.js';
import { DEFAULT_SETTINGS } from './gateway.settings.js';
import type { GatewayState, InboundMessage, PipelineContext } from './gateway.types.js';
import { routeCommand } from './router.js';
import { EMPTY_REMINDERS } from './reminder.types.js';

const DAY = '2024-01-01';

/** A clean state where nothing blocks the AI call: no lists, no rate history, cap unused. */
const cleanState = (cc: string): GatewayState => ({
  reminders: EMPTY_REMINDERS,
  stopList: new Set(),
  allowlist: new Set(),
  rate: new Map(),
  slowDown: new Map(),
  counters: zeroCounters(DAY),
  settings: { ...DEFAULT_SETTINGS, allowlistMode: false, ownNumber: null, defaultCountryCode: cc },
});

const RUN: PipelineContext = { paused: false, today: DAY };

/** No-op backstop timer: never fires, cancel does nothing. */
const noTimer: NonNullable<PipelineDeps['startTimer']> = () => () => undefined;

/** A free question, or a SCAM command with free text, in any Language. */
const aiBody: fc.Arbitrary<string> = languageArb.chain((language) =>
  fc.oneof(body(language), body(language).map((text) => 'SCAM ' + text)),
);

const reachesAi = (text: string): boolean => {
  const routed = routeCommand(text);
  return (routed.command === 'QUESTION' || routed.command === 'SCAM') && !routed.argumentMissing;
};

describe('Gateway_Pipeline AI privacy', () => {
  // Feature: necromancer-sms-gateway, Property 19: The AI never sees sender data
  // **Validates: Requirements 6.9**
  it('Req 6.9: no Mock_Client prompt contains the sender address, number, masks or receive time', async () => {
    let aiCalls = 0;
    await fc.assert(
      fc.asyncProperty(
        countryCode.chain((cc) => fc.tuple(fc.constant(cc), formattedNumber(cc))),
        timeArb,
        aiBody,
        async ([cc, formatted], receivedAt, text) => {
          const { number, address } = formatted;
          const forbidden = [
            address,
            number,
            number.slice(1),
            maskNumber(number),
            maskSender(address),
            String(receivedAt),
          ];
          fc.pre(reachesAi(text));
          fc.pre(forbidden.every((f) => !text.includes(f)));

          const client = createMockClient([{ text: 'A short answer.' }]);
          const answer: AnswerDeps = {
            client,
            cache: createMemoryCache(),
            clock: () => receivedAt,
          };
          const msg: InboundMessage = { id: 'm1', seq: 1, sender: address, body: text, receivedAt };
          await runGatewayPipeline(msg, cleanState(cc), RUN, { answer, startTimer: noTimer });

          aiCalls += client.calls.length;
          for (const prompt of client.calls) {
            for (const f of forbidden) {
              expect(prompt.system).not.toContain(f);
              expect(prompt.user).not.toContain(f);
            }
          }
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
    // The property is not vacuous: the AI was reached in some runs.
    expect(aiCalls).toBeGreaterThan(0);
  });
});
