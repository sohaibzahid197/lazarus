// Property test for the Gateway_Pipeline reply source table (task 9.9).
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMockClient } from './ai.mock.js';
import { createMemoryCache } from './answer.cache.js';
import type { AnswerDeps } from './answer.types.js';
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
import { GATEWAY_TEXTS } from './gateway.texts.js';
import type { GatewayState, InboundMessage, PipelineContext } from './gateway.types.js';
import { routeCommand } from './router.js';
import type { Language, RoutedCommand } from './router.types.js';
import { splitSms } from './sms.js';

const DAY = '2024-01-01';
const QUESTION_SENTINEL = 'SENTINEL answerQuestion reply.';
const SCAM_SENTINEL = 'SENTINEL checkScam reply.';

/** Clean state: no lists, Allowlist_Mode off, no rate history, cap 2000, no Own_Number. */
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
    dailySendCap: 2000,
    defaultCountryCode: cc,
  },
});

const RUN: PipelineContext = { paused: false, today: DAY };

/** No-op backstop timer: never fires, cancel does nothing. */
const noTimer: NonNullable<PipelineDeps['startTimer']> = () => () => undefined;

type Call = readonly [AnswerDeps, string, Language | undefined];

interface Expected {
  readonly text: string;
  readonly questionCalls: number;
  readonly scamCalls: number;
}

/** The "Reply text selection" table, written independently of the pipeline. */
function expectedFor(routed: RoutedCommand): Expected {
  const { command, argument, argumentMissing, language } = routed;
  const texts = GATEWAY_TEXTS[language];
  const fixed = (text: string): Expected => ({ text, questionCalls: 0, scamCalls: 0 });
  switch (command) {
    case 'HELP':
      return fixed(texts.help);
    case 'QUESTION':
      return argument.trim() === ''
        ? fixed(texts.help)
        : { text: QUESTION_SENTINEL, questionCalls: 1, scamCalls: 0 };
    case 'SCAM':
      return argumentMissing
        ? fixed(texts.usage.SCAM)
        : { text: SCAM_SENTINEL, questionCalls: 0, scamCalls: 1 };
    case 'REMIND':
    case 'TRANSLATE':
      return fixed(argumentMissing ? texts.usage[command] : texts.notAvailable);
    case 'START':
      return fixed(texts.welcomeBack);
    case 'STOP':
      throw new Error('STOP has no Reply_Text and is excluded');
  }
}

/** Any body in any Language, plus the empty and whitespace-only bodies (Requirement 1.8). */
const bodyArb: fc.Arbitrary<string> = fc.oneof(
  languageArb.chain(body),
  anyBody,
  fc.constantFrom('', ' ', '\n'),
);

describe('Gateway_Pipeline reply source', () => {
  // Feature: necromancer-sms-gateway, Property 17: Reply source follows the command table
  // **Validates: Requirements 1.8, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7**
  it('Req 1.8, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7: parts and Answer_Service calls follow the command table', async () => {
    await fc.assert(
      fc.asyncProperty(
        countryCode.chain((cc) => fc.tuple(fc.constant(cc), formattedNumber(cc))),
        timeArb,
        bodyArb,
        async ([cc, formatted], receivedAt, text) => {
          const routed = routeCommand(text);
          fc.pre(routed.command !== 'STOP');
          const expected = expectedFor(routed);

          const questionCalls: Call[] = [];
          const scamCalls: Call[] = [];
          const answer: AnswerDeps = {
            client: createMockClient([{ text: 'unused' }]),
            cache: createMemoryCache(),
            clock: () => receivedAt,
          };
          const deps: PipelineDeps = {
            answer,
            startTimer: noTimer,
            answerQuestion: (d, argument, language) => {
              questionCalls.push([d, argument, language]);
              return Promise.resolve(QUESTION_SENTINEL);
            },
            checkScam: (d, argument, language) => {
              scamCalls.push([d, argument, language]);
              return Promise.resolve(SCAM_SENTINEL);
            },
          };
          const msg: InboundMessage = {
            id: 'm1',
            seq: 1,
            sender: formatted.address,
            body: text,
            receivedAt,
          };

          const decision = await runGatewayPipeline(msg, cleanState(cc), RUN, deps);

          expect(decision.parts).toEqual(splitSms(expected.text));
          expect(questionCalls).toHaveLength(expected.questionCalls);
          expect(scamCalls).toHaveLength(expected.scamCalls);
          for (const call of [...questionCalls, ...scamCalls]) {
            expect(call).toEqual([answer, routed.argument, routed.language]);
            expect(call[0]).toBe(answer);
          }
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
