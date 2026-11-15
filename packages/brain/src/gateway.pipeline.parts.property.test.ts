// Property test for the Gateway_Pipeline: accepted replies have 1 to 4 parts (task 9.10).
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMockClient } from './ai.mock.js';
import { createMemoryCache } from './answer.cache.js';
import type { answerQuestion } from './answer.service.js';
import type { AnswerDeps } from './answer.types.js';
import { gsm7TextArb, ucs2TextArb } from './arbitraries.js';
import { detectEncoding } from './encoding.js';
import {
  GATEWAY_PBT_OPTIONS,
  anyBody,
  body,
  countryCode,
  formattedNumber,
  languageArb,
  timeArb,
} from './gateway.arbitraries.js';
import { zeroCounters } from './gateway.counters.js';
import { runGatewayPipeline, type PipelineDeps } from './gateway.pipeline.js';
import { DEFAULT_SETTINGS } from './gateway.settings.js';
import type { GatewayState, InboundMessage, PipelineContext } from './gateway.types.js';
import { MAX_PARTS, getPartLimits } from './limits.js';
import { plainLatinWordArb, urduCharArb } from './router.arbitraries.js';
import { splitSms } from './sms.js';
import { countCodeUnits } from './units.js';

const DAY = '2024-01-01';
const MAX_AI_CHARS = 2000;

/** A clean state with a large cap and rate limit, so nothing blocks the reply. */
const cleanState = (cc: string): GatewayState => ({
  stopList: new Set(),
  allowlist: new Set(),
  rate: new Map(),
  slowDown: new Map(),
  counters: zeroCounters(DAY),
  settings: {
    ...DEFAULT_SETTINGS,
    allowlistMode: false,
    ownNumber: null,
    defaultCountryCode: cc,
    perNumberLimit: 60,
    dailySendCap: 2000,
  },
});

const RUN: PipelineContext = { paused: false, today: DAY };

/** No-op backstop timer: never fires, cancel does nothing. */
const noTimer: NonNullable<PipelineDeps['startTimer']> = () => () => undefined;

const urduWordArb = fc.string({ unit: urduCharArb, minLength: 1, maxLength: 8 });

/** AI text from short to very long (up to 2000 chars), GSM-7, Urdu or mixed. */
const aiTextArb: fc.Arbitrary<string> = fc
  .array(fc.oneof(plainLatinWordArb, urduWordArb, gsm7TextArb, ucs2TextArb), {
    minLength: 1,
    maxLength: 300,
  })
  .map((words) => words.join(' ').slice(0, MAX_AI_CHARS));

/** Free questions and SCAM commands (reach the AI) plus any other body. */
const bodyArb: fc.Arbitrary<string> = fc.oneof(
  languageArb.chain((language) =>
    fc.oneof(body(language), body(language).map((text) => 'SCAM ' + text)),
  ),
  anyBody,
);

/** Every part fits one SMS segment for the Reply_Text's encoding. */
function fitsSegments(parts: readonly string[], replyText: string): boolean {
  const encoding = detectEncoding(replyText);
  const { single, multi } = getPartLimits(encoding);
  const limit = parts.length === 1 ? single : multi;
  return parts.every((p) => countCodeUnits(p, encoding) <= limit);
}

describe('Gateway_Pipeline reply part counts', () => {
  // Feature: necromancer-sms-gateway, Property 18: Accepted replies have 1 to 4 parts
  // **Validates: Requirements 6.8, 6.10**
  it('Req 6.8, 6.10: accepted replies have 1 to 4 parts equal to splitSms of the Reply_Text', async () => {
    let aiReplies = 0;
    let longReplies = 0;
    await fc.assert(
      fc.asyncProperty(
        countryCode.chain((cc) => fc.tuple(fc.constant(cc), formattedNumber(cc))),
        timeArb,
        bodyArb,
        aiTextArb,
        async ([cc, formatted], receivedAt, text, aiText) => {
          const splitInputs: string[] = [];
          const split = (t: string): string[] => {
            splitInputs.push(t);
            return splitSms(t);
          };
          let aiCalls = 0;
          const spy: typeof answerQuestion = () => {
            aiCalls += 1;
            return Promise.resolve(aiText);
          };
          const answer: AnswerDeps = {
            client: createMockClient([]),
            cache: createMemoryCache(),
            clock: () => receivedAt,
          };
          const msg: InboundMessage = {
            id: 'm1',
            seq: 1,
            sender: formatted.address,
            body: text,
            receivedAt,
          };
          const decision = await runGatewayPipeline(msg, cleanState(cc), RUN, {
            answer,
            answerQuestion: spy,
            checkScam: spy,
            split,
            startTimer: noTimer,
          });
          const accepted = decision.outcome === 'replied' || decision.outcome === 'started';
          if (!accepted || decision.parts.length === 0) return;

          // Requirement 6.8: the splitter is called exactly once with the Reply_Text.
          expect(splitInputs).toHaveLength(1);
          const replyText = splitInputs[0] as string;
          if (aiCalls > 0) {
            expect(replyText).toBe(aiText);
            aiReplies += 1;
          }
          if (decision.parts.length > 1) longReplies += 1;

          // Requirement 6.10: 1 to 4 parts, equal to splitSms of the Reply_Text.
          expect(decision.parts.length).toBeGreaterThanOrEqual(1);
          expect(decision.parts.length).toBeLessThanOrEqual(MAX_PARTS);
          expect(decision.parts).toEqual(splitSms(replyText));
          expect(fitsSegments(decision.parts, replyText)).toBe(true);
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
    // Not vacuous: AI replies and multi-part replies both occurred.
    expect(aiReplies).toBeGreaterThan(0);
    expect(longReplies).toBeGreaterThan(0);
  });
});
