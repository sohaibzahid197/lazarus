// One example test per Outcome (Requirement 7.4, 18.3, 18.4). Each test asserts
// the recorded Outcome and the number of Reply_Parts (0 to 4). The AI_Client is
// the Mock_Client and the Sms_Sender is a recording test double.
import { describe, expect, it } from 'vitest';
import { createMockClient, type MockClient } from './ai.mock.js';
import { createMemoryCache } from './answer.cache.js';
import type { AnswerDeps } from './answer.types.js';
import { reserveParts, zeroCounters } from './gateway.counters.js';
import { finalizeSend, runGatewayPipeline, type PipelineDeps } from './gateway.pipeline.js';
import { DEFAULT_SETTINGS } from './gateway.settings.js';
import { GATEWAY_TEXTS } from './gateway.texts.js';
import {
  OUTCOMES,
  type CanonicalNumber,
  type FinalOutcome,
  type GatewayDecision,
  type GatewayState,
  type InboundMessage,
  type Outcome,
  type PartResult,
  type PipelineContext,
  type SendReport,
} from './gateway.types.js';
import { splitSms } from './sms.js';

const DAY = '2024-01-01';
const T0 = Date.UTC(2024, 0, 1, 6, 0);
const NUM = '+923001234567' as CanonicalNumber;
const ADDRESS = '03001234567';
const RUN: PipelineContext = { paused: false, today: DAY };
const PAUSED: PipelineContext = { paused: true, today: DAY };
const noTimer: NonNullable<PipelineDeps['startTimer']> = () => () => undefined;

const baseState = (over: Partial<GatewayState> = {}): GatewayState => ({
  stopList: new Set(),
  allowlist: new Set(),
  rate: new Map(),
  slowDown: new Map(),
  counters: zeroCounters(DAY),
  settings: DEFAULT_SETTINGS,
  ...over,
});

let seq = 0;
const msg = (body: string, sender = ADDRESS): InboundMessage => ({
  id: `m${++seq}`,
  seq,
  sender,
  body,
  receivedAt: T0,
});

function mockAnswer(text = 'A short answer.'): { answer: AnswerDeps; client: MockClient } {
  const client = createMockClient([{ text }]);
  return { answer: { client, cache: createMemoryCache(), clock: () => T0 }, client };
}

interface SendRequest {
  readonly number: CanonicalNumber;
  readonly parts: readonly string[];
}

/**
 * Recording Sms_Sender double: records each requested send and returns a
 * scripted report. A number on its Stop_List gets `refused-stopped`
 * (Requirement 3.8), as the real sender checks the persisted Stop_List.
 */
function recordingSender(script: readonly PartResult[] | 'all-sent', stopList: ReadonlySet<CanonicalNumber>) {
  const sends: SendRequest[] = [];
  const send = (number: CanonicalNumber, parts: readonly string[]): SendReport => {
    sends.push({ number, parts: [...parts] });
    if (stopList.has(number)) return { status: 'refused-stopped' };
    const results = script === 'all-sent' ? parts.map((): PartResult => 'sent') : script;
    return { status: 'done', results, attempts: 1 };
  };
  return { sends, send };
}

/** Hands the decision's parts to the sender (none when empty, Requirement 8.10) and finalizes. */
function deliver(
  decision: GatewayDecision,
  state: GatewayState,
  sender: ReturnType<typeof recordingSender>,
): FinalOutcome {
  let report: SendReport | null = null;
  if (decision.parts.length > 0) {
    if (decision.sender.kind !== 'phone') throw new Error('parts for a non-phone sender');
    report = sender.send(decision.sender.number, decision.parts);
  }
  return finalizeSend(decision, report, state.counters, DAY);
}

const covered = new Set<Outcome>();

/** Runs the pipeline, then the recording sender and finalizeSend. */
async function scenario(
  outcome: Outcome,
  m: InboundMessage,
  state: GatewayState,
  ctx: PipelineContext,
  opts: {
    answer?: AnswerDeps | null;
    script?: readonly PartResult[] | 'all-sent';
    senderStopList?: ReadonlySet<CanonicalNumber>;
  } = {},
) {
  const deps: PipelineDeps = { answer: opts.answer ?? null, startTimer: noTimer };
  const decision = await runGatewayPipeline(m, state, ctx, deps);
  const sender = recordingSender(opts.script ?? 'all-sent', opts.senderStopList ?? state.stopList);
  const final = deliver(decision, state, sender);
  expect(final.outcome).toBe(outcome);
  covered.add(final.outcome);
  return { decision, final, sends: sender.sends };
}

const partsOf = (text: string): number => splitSms(text).length;

describe('gateway.pipeline: one example per Outcome (Requirement 7.4, 18.4)', () => {
  it('replied: a question answered by the Mock_Client, 1 Reply_Part sent', async () => {
    const { answer, client } = mockAnswer('A short answer.');
    const { decision, final, sends } = await scenario(
      'replied',
      msg('What is the capital of France?'),
      baseState(),
      RUN,
      { answer },
    );
    expect(decision.outcome).toBe('replied');
    expect(decision.parts).toEqual(['A short answer.']);
    expect(final.partsSent).toBe(1);
    expect(client.calls).toHaveLength(1);
    expect(sends).toEqual([{ number: NUM, parts: ['A short answer.'] }]);
  });

  it('stopped: STOP adds the number to the Stop_List with 0 Reply_Parts', async () => {
    const { decision, final, sends } = await scenario('stopped', msg('STOP'), baseState(), RUN);
    expect(decision.parts).toHaveLength(0);
    expect(decision.changes).toContainEqual({ type: 'stop-add', number: NUM });
    expect(final.partsSent).toBe(0);
    expect(sends).toHaveLength(0);
  });

  it('started: START from a stopped number sends the Welcome_Back_Text', async () => {
    const state = baseState({ stopList: new Set([NUM]) });
    const { decision, final, sends } = await scenario('started', msg('START'), state, RUN, {
      senderStopList: new Set(),
    });
    const expected = partsOf(GATEWAY_TEXTS.en.welcomeBack);
    expect(decision.parts).toHaveLength(expected);
    expect(expected).toBeGreaterThanOrEqual(1);
    expect(expected).toBeLessThanOrEqual(4);
    expect(decision.changes).toContainEqual({ type: 'stop-remove', number: NUM });
    expect(final.partsSent).toBe(expected);
    expect(sends).toHaveLength(1);
  });

  it('ignored-stopped: the Sms_Sender refuses a number on its Stop_List, 0 parts sent', async () => {
    // The pipeline decided a HELP reply; a STOP was persisted before the send.
    const { decision, final, sends } = await scenario('ignored-stopped', msg('HELP'), baseState(), RUN, {
      senderStopList: new Set([NUM]),
    });
    expect(decision.outcome).toBe('replied');
    expect(decision.parts).toHaveLength(partsOf(GATEWAY_TEXTS.en.help));
    expect(sends).toHaveLength(1);
    expect(final.partsSent).toBe(0);
    // The handed parts are released.
    const counters = final.changes.find((c) => c.type === 'counters');
    expect(counters?.type === 'counters' && counters.counters.handed).toBe(0);
  });

  it('ignored-not-allowed: Allowlist_Mode on and the number not listed, 0 Reply_Parts', async () => {
    const state = baseState({ settings: { ...DEFAULT_SETTINGS, allowlistMode: true } });
    const { decision, final, sends } = await scenario('ignored-not-allowed', msg('HELP'), state, RUN);
    expect(decision.parts).toHaveLength(0);
    expect(final.partsSent).toBe(0);
    expect(sends).toHaveLength(0);
  });

  it('ignored-automated: an alphanumeric sender ID, 0 Reply_Parts', async () => {
    const { decision, final, sends } = await scenario(
      'ignored-automated',
      msg('HELP', 'JAZZ'),
      baseState(),
      RUN,
    );
    expect(decision.parts).toHaveLength(0);
    expect(decision.changes).toEqual([]);
    expect(final.partsSent).toBe(0);
    expect(sends).toHaveLength(0);
  });

  it('ignored-own-number: the Own_Number in international format, 0 Reply_Parts', async () => {
    const state = baseState({ settings: { ...DEFAULT_SETTINGS, ownNumber: NUM } });
    const { decision, final, sends } = await scenario(
      'ignored-own-number',
      msg('HELP', '+92 300 1234567'),
      state,
      RUN,
    );
    expect(decision.parts).toHaveLength(0);
    expect(decision.changes).toEqual([]);
    expect(final.partsSent).toBe(0);
    expect(sends).toHaveLength(0);
  });

  it('ignored-paused: a non-STOP message while paused, 0 Reply_Parts', async () => {
    const { decision, final, sends } = await scenario('ignored-paused', msg('HELP'), baseState(), PAUSED);
    expect(decision.parts).toHaveLength(0);
    expect(final.partsSent).toBe(0);
    expect(sends).toHaveLength(0);
  });

  it('rate-limited: over the Per_Number_Limit sends one Slow_Down_Text', async () => {
    const state = baseState({
      settings: { ...DEFAULT_SETTINGS, perNumberLimit: 1 },
      rate: new Map([[NUM, [T0 - 1_000]]]),
    });
    const { decision, final, sends } = await scenario('rate-limited', msg('HELP'), state, RUN);
    const expected = partsOf(GATEWAY_TEXTS.en.slowDown);
    expect(decision.parts).toHaveLength(expected);
    expect(expected).toBeGreaterThanOrEqual(1);
    expect(expected).toBeLessThanOrEqual(4);
    expect(final.partsSent).toBe(expected);
    expect(sends).toHaveLength(1);
  });

  it('send-capped: today at the Daily_Send_Cap, 0 Reply_Parts', async () => {
    const state = baseState({
      settings: { ...DEFAULT_SETTINGS, dailySendCap: 1 },
      counters: reserveParts(zeroCounters(DAY), DAY, 1),
    });
    const { decision, final, sends } = await scenario('send-capped', msg('HELP'), state, RUN);
    expect(decision.parts).toHaveLength(0);
    expect(final.partsSent).toBe(0);
    expect(sends).toHaveLength(0);
  });

  it('send-failed: the Sms_Sender reports a failed part, only sent parts counted', async () => {
    const { answer } = mockAnswer('A short answer.');
    const { decision, final, sends } = await scenario(
      'send-failed',
      msg('What is the capital of France?'),
      baseState(),
      RUN,
      { answer, script: ['failed-other'] },
    );
    expect(decision.outcome).toBe('replied');
    expect(decision.parts).toHaveLength(1);
    expect(sends).toEqual([{ number: NUM, parts: ['A short answer.'] }]);
    expect(final.partsSent).toBe(0);
  });

  it('covers all 11 Outcomes', () => {
    expect(OUTCOMES).toHaveLength(11);
    for (const outcome of OUTCOMES) expect(covered.has(outcome), outcome).toBe(true);
  });
});
