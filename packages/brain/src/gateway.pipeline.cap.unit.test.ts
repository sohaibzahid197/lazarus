// Unit tests for the Daily_Send_Cap boundary and the no-key path (task 9.15).
// Requirements 5.8, 6.9, 16.18, 18.3, 18.8, 18.9.
import { describe, expect, it } from 'vitest';
import { createMockClient, type MockClient } from './ai.mock.js';
import { createMemoryCache } from './answer.cache.js';
import { FIXED_TEXTS } from './answer.texts.js';
import type { AnswerDeps } from './answer.types.js';
import { reserveParts, zeroCounters } from './gateway.counters.js';
import { maskNumber, maskSender } from './gateway.number.js';
import { applyChanges, runGatewayPipeline, type PipelineDeps } from './gateway.pipeline.js';
import { DEFAULT_SETTINGS } from './gateway.settings.js';
import type {
  CanonicalNumber,
  GatewayDecision,
  GatewayState,
  InboundMessage,
  PipelineContext,
} from './gateway.types.js';
import { splitSms } from './sms.js';
import { EMPTY_REMINDERS } from './reminder.types.js';

const DAY = '2024-01-01';
const T0 = Date.UTC(2024, 0, 1, 6, 0);
const ADDRESS = '0300 1234567';
const NUM = '+923001234567' as CanonicalNumber;
const RUN: PipelineContext = { paused: false, today: DAY };

/** Backstop timer that never fires. */
const noTimer: NonNullable<PipelineDeps['startTimer']> = () => () => undefined;

/** An AI answer of about 300 GSM-7 characters, so splitSms gives 2 parts. */
const LONG_ANSWER = 'Rain forms when water vapour cools into drops that fall. '.repeat(5).trim();
const SHORT_ANSWER = 'Rain is water falling from clouds.';

const stateWith = (cap: number, handed: number, over: Partial<GatewayState> = {}): GatewayState => ({
  reminders: EMPTY_REMINDERS,
  stopList: new Set(),
  allowlist: new Set(),
  rate: new Map(),
  slowDown: new Map(),
  counters: reserveParts(zeroCounters(DAY), DAY, handed),
  settings: { ...DEFAULT_SETTINGS, allowlistMode: false, ownNumber: null, dailySendCap: cap },
  ...over,
});

let seq = 0;
const msg = (body: string, receivedAt = T0): InboundMessage => ({
  id: `m${String(++seq)}`,
  seq,
  sender: ADDRESS,
  body,
  receivedAt,
});

const answerDeps = (client: MockClient): AnswerDeps => ({
  client,
  cache: createMemoryCache(),
  clock: () => T0,
});

const withKey = (text: string): { client: MockClient; deps: PipelineDeps } => {
  const client = createMockClient([{ text }]);
  return { client, deps: { answer: answerDeps(client), startTimer: noTimer } };
};

const NO_KEY: PipelineDeps = { answer: null, startTimer: noTimer };

const handedAfter = (state: GatewayState, d: GatewayDecision): number =>
  applyChanges(state, d.changes).counters.handed;

describe('Daily_Send_Cap boundary (Requirements 5.8, 18.8)', () => {
  it('a fixed reply that brings handed exactly to the cap is sent; one part over is send-capped', async () => {
    const fits = stateWith(5, 4);
    const sent = await runGatewayPipeline(msg('HELP'), fits, RUN, NO_KEY);
    expect(sent.outcome).toBe('replied');
    expect(sent.parts).toHaveLength(1);
    expect(handedAfter(fits, sent)).toBe(5);

    const atCap = stateWith(5, 5);
    const capped = await runGatewayPipeline(msg('HELP'), atCap, RUN, NO_KEY);
    expect(capped.outcome).toBe('send-capped');
    expect(capped.parts).toEqual([]);
    expect(handedAfter(atCap, capped)).toBe(5);
  });

  it('a multipart AI answer that fits exactly is sent; the same answer 1 part over is send-capped', async () => {
    const probe = withKey(LONG_ANSWER);
    const free = await runGatewayPipeline(msg('what is rain?'), stateWith(100, 0), RUN, probe.deps);
    const n = free.parts.length;
    expect(n).toBeGreaterThanOrEqual(2);

    const handed = 3;
    const exact = stateWith(handed + n, handed);
    const a = withKey(LONG_ANSWER);
    const sent = await runGatewayPipeline(msg('what is rain?'), exact, RUN, a.deps);
    expect(sent.outcome).toBe('replied');
    expect(sent.parts).toHaveLength(n);
    expect(handedAfter(exact, sent)).toBe(handed + n);

    const oneShort = stateWith(handed + n - 1, handed);
    const b = withKey(LONG_ANSWER);
    const capped = await runGatewayPipeline(msg('what is rain?'), oneShort, RUN, b.deps);
    expect(capped.outcome).toBe('send-capped');
    expect(capped.parts).toEqual([]);
    expect(handedAfter(oneShort, capped)).toBe(handed);
  });
});

describe('No Gemini_Api_Key (Requirements 16.18, 18.9)', () => {
  it.each([
    ['QUESTION', 'what is rain?'],
    ['SCAM', 'SCAM you won a prize, send 500 rupees'],
  ])('%s with an argument gets the Try_Later_Text and makes 0 Mock_Client calls', async (_, body) => {
    const client = createMockClient([{ text: SHORT_ANSWER }]);
    const d = await runGatewayPipeline(msg(body), stateWith(100, 0), RUN, NO_KEY);
    expect(d.outcome).toBe('replied');
    expect(d.parts).toEqual(splitSms(FIXED_TEXTS.en.tryLater));
    expect(client.calls).toHaveLength(0);
  });

  it.each([
    ['HELP', stateWith(100, 0)],
    ['STOP', stateWith(100, 0)],
    ['START', stateWith(100, 0, { stopList: new Set([NUM]) })],
  ])('%s gives the same Outcome, Reply_Parts and changes with or without a key', async (body, state) => {
    const keyed = withKey(SHORT_ANSWER);
    const withAi = await runGatewayPipeline(msg(body), state, RUN, keyed.deps);
    const without = await runGatewayPipeline(msg(body), state, RUN, NO_KEY);
    expect(without.outcome).toBe(withAi.outcome);
    expect(without.parts).toEqual(withAi.parts);
    expect(without.changes).toEqual(withAi.changes);
    expect(keyed.client.calls).toHaveLength(0);
  });
});

describe('AI privacy (Requirement 6.9)', () => {
  it('Mock_Client prompts contain no Sender_Address, Canonical_Number, Masked_Number or Masked_Sender', async () => {
    const forbidden = [ADDRESS, NUM, NUM.slice(1), maskNumber(NUM), maskSender(ADDRESS)];
    const client = createMockClient([{ text: SHORT_ANSWER }]);
    const deps: PipelineDeps = { answer: answerDeps(client), startTimer: noTimer };
    await runGatewayPipeline(msg('what is rain?'), stateWith(100, 0), RUN, deps);
    await runGatewayPipeline(msg('SCAM you won a prize', T0 + 1), stateWith(100, 0), RUN, deps);

    expect(client.calls.length).toBeGreaterThanOrEqual(2);
    for (const prompt of client.calls) {
      for (const f of forbidden) {
        expect(prompt.system).not.toContain(f);
        expect(prompt.user).not.toContain(f);
      }
    }
  });
});
