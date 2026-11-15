// Feature: crypt-ouija-simulator, Property 17: Message handling equals the brain composition
import fc from 'fast-check';
import {
  AI_ERROR_KINDS,
  AiError,
  applyChanges,
  createMemoryCache,
  createMockClient,
  finalizeSend,
  localDayKey,
  maskPhoneNumbers,
  redactSecrets,
  runGatewayPipeline,
  type AiErrorKind,
  type AnswerDeps,
  type GatewayState,
  type InboundMessage,
  type MockStep,
  type PipelineContext,
  type SendReport,
} from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorResponse } from '../protocol/wire.types';
import { aiReplyArb, messageBodyArb } from '../test/arbitraries/request';
import { snapshotAtArb } from '../test/arbitraries/snapshot';
import { makeHandler, post } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { parseSnapshot } from './snapshot.parse';
import { printSnapshot } from './snapshot.print';
import { SIMULATOR_NUMBER } from './simulatorNumber';

/** The mock AI behaviour of one run: a reply text or an AI error kind (9.4). */
type AiBehaviour = { readonly reply: string } | { readonly error: AiErrorKind };

const aiBehaviourArb: fc.Arbitrary<AiBehaviour> = fc.oneof(
  { weight: 4, arbitrary: aiReplyArb.map((reply): AiBehaviour => ({ reply })) },
  { weight: 1, arbitrary: fc.constantFrom(...AI_ERROR_KINDS).map((error): AiBehaviour => ({ error })) },
);

function stepsFor(ai: AiBehaviour): readonly MockStep[] {
  return 'error' in ai ? [{ error: new AiError(ai.error) }] : [{ text: ai.reply }];
}

/** Redact then mask, written with the brain exports directly (17.2). */
function clean(text: string, secrets: readonly string[]): string {
  return maskPhoneNumbers(redactSecrets(text, secrets));
}

interface PipelineCall {
  readonly msg: InboundMessage;
  readonly ctx: PipelineContext;
}

interface Expected {
  readonly command: SimulatorResponse['command'];
  readonly language: SimulatorResponse['language'];
  readonly outcome: SimulatorResponse['outcome'];
  readonly texts: readonly string[];
  readonly snapshot: SessionSnapshot;
}

/** Reference: parse → pipeline → apply → finalizeSend (all sent) → apply → print, then sanitize. */
async function reference(
  snapshot: SessionSnapshot,
  serverTime: number,
  msg: InboundMessage,
  answer: AnswerDeps | null,
  secrets: readonly string[],
): Promise<Expected> {
  const parsed = parseSnapshot(snapshot, serverTime, SIMULATOR_NUMBER);
  if (!parsed.ok) throw new Error(`parseSnapshot rejected a valid snapshot: ${parsed.error}`);
  const today = localDayKey(serverTime, 300);
  const decision = await runGatewayPipeline(msg, parsed.state, { paused: false, today }, { answer });
  const s1: GatewayState = applyChanges(parsed.state, decision.changes);
  const report: SendReport | null =
    decision.parts.length === 0
      ? null
      : { status: 'done', results: decision.parts.map(() => 'sent' as const), attempts: 1 };
  const final = finalizeSend(decision, report, s1.counters, today);
  const s2 = applyChanges(s1, final.changes);
  const printed = printSnapshot(s2, SIMULATOR_NUMBER);
  return {
    command: decision.command,
    language: decision.language,
    outcome: final.outcome,
    texts: decision.parts.map((p) => clean(p, secrets)),
    snapshot: {
      ...printed,
      reminders: printed.reminders.map((r) => ({ ...r, text: clean(r.text, secrets) })),
    },
  };
}

describe('Message handling equals the brain composition', () => {
  /**
   * **Validates: Requirements 7.1, 7.2, 7.3, 7.5, 12.4, 12.6, 12.7**
   */
  it('Feature: crypt-ouija-simulator, Property 17: Message handling equals the brain composition', async () => {
    await fc.assert(
      fc.asyncProperty(
        snapshotAtArb,
        messageBodyArb,
        aiBehaviourArb,
        fc.boolean(),
        async ({ serverTime, snapshot }, body, ai, withKey) => {
          const calls: PipelineCall[] = [];
          const h = makeHandler({
            now: serverTime,
            withKey,
            ...('error' in ai ? { aiError: ai.error } : { aiReply: ai.reply }),
            brain: {
              runGatewayPipeline: (msg, state, ctx, deps) => {
                calls.push({ msg, ctx });
                return runGatewayPipeline(msg, state, ctx, deps);
              },
            },
          });

          const res = await post(h.handler, { type: 'message', body, snapshot });
          expect(res.status).toBe(200);

          // Exactly one pipeline call with the inputs of 7.1 and 7.2.
          expect(calls).toHaveLength(1);
          const call = calls[0];
          if (call === undefined) throw new Error('no pipeline call');
          expect(call.msg.sender).toBe(SIMULATOR_NUMBER);
          expect(call.msg.body).toBe(body);
          expect(call.msg.receivedAt).toBe(serverTime);
          expect(call.ctx).toEqual({ paused: false, today: localDayKey(serverTime, 300) });

          // The reference gets its own mock client and cache with the same behaviour.
          const answer: AnswerDeps | null =
            h.ai.answer === null
              ? null
              : { ...h.ai.answer, client: createMockClient(stepsFor(ai)), cache: createMemoryCache() };
          const expected = await reference(snapshot, serverTime, call.msg, answer, h.ai.secrets);

          const got = res.json as SimulatorResponse;
          expect(got.kind).toBe('message');
          expect(got.command).toBe(expected.command);
          expect(got.language).toBe(expected.language);
          expect(got.outcome).toBe(expected.outcome);
          expect(got.deliveryOutcome).toBeNull();
          expect(got.parts.map((p) => p.text)).toEqual(expected.texts);
          expect(got.snapshot).toEqual(expected.snapshot);
          expect(got.serverTime).toBe(serverTime);
        },
      ),
      CRYPT_PBT_OPTIONS,
    );
  });
});
