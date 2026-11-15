import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMockClient } from './ai.mock.js';
import { createMemoryCache } from './answer.cache.js';
import type { AnswerDeps } from './answer.types.js';
import {
  automatedAddress,
  canonicalNumber,
  canonicalNumberIn,
  countryCode,
  dayKeyArb,
  formattingOf,
  gatewayState,
  timeArb,
} from './gateway.arbitraries.js';
import { runGatewayPipeline, type PipelineDeps } from './gateway.pipeline.js';
import { FIXED_TEXTS } from './answer.texts.js';
import { GATEWAY_TEXTS } from './gateway.texts.js';
import type {
  CanonicalNumber,
  GatewayDecision,
  GatewayState,
  InboundMessage,
  Outcome,
  PipelineContext,
} from './gateway.types.js';
import {
  REMINDER_PBT_OPTIONS,
  printableReminderText,
  reminderStore,
  reminderText,
  slotSpelling,
  timeExpression,
} from './reminder.arbitraries.js';
import { printTimeExpression } from './reminder.print.js';
import type { ReminderState } from './reminder.types.js';
import { caseMutate } from './router.arbitraries.js';
import { routeCommand } from './router.js';
import type { Language } from './router.types.js';
import { splitSms } from './sms.js';

const LANGUAGES: readonly Language[] = ['en', 'ur', 'roman-ur'];
const REMINDER_COMMANDS = new Set(['REMIND', 'LIST', 'CANCEL']);

const remindKeyword = fc.constantFrom('remind', 'yaad', 'یاد').chain(caseMutate);
const listKeyword = fc.constantFrom('list', 'fehrist', 'فہرست').chain(caseMutate);
const cancelKeyword = fc.constantFrom('cancel', 'mansookh', 'منسوخ').chain(caseMutate);

const nearTime: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 120 })
  .map((n) => printTimeExpression({ kind: 'relative', amount: n, unit: 'minute' }));

/** REMIND arguments: valid, bad time, too long, past, too far, no text, random. */
const remindArgument: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(nearTime, printableReminderText).map(([w, t]) => `${w} ${t}`),
  fc.tuple(timeExpression.map(printTimeExpression), reminderText).map(([w, t]) => `${w} ${t}`),
  fc.tuple(nearTime, fc.integer({ min: 141, max: 300 })).map(([w, n]) => `${w} ${'x'.repeat(n)}`),
  fc.constantFrom('today 8am x', 'in 31 days x', 'in 43201 minutes x'),
  nearTime,
  fc.string({ minLength: 1, maxLength: 40 }),
);

const cancelArgument: fc.Arbitrary<string> = fc.oneof(
  fc.integer({ min: 0, max: 999 }).chain(slotSpelling),
  fc.integer({ min: 1, max: 5 }).chain(slotSpelling),
  fc.string({ minLength: 1, maxLength: 10 }),
);

const withArg = (kw: fc.Arbitrary<string>, arg: fc.Arbitrary<string>): fc.Arbitrary<string> =>
  fc
    .tuple(kw, fc.option(arg, { nil: null, freq: 4 }))
    .map(([k, a]) => (a === null ? k : `${k} ${a}`));

/** A body the router sends to REMIND, LIST or CANCEL. */
const reminderBody: fc.Arbitrary<string> = fc
  .oneof(
    withArg(remindKeyword, remindArgument),
    withArg(listKeyword, fc.string({ minLength: 1, maxLength: 20 })),
    withArg(cancelKeyword, cancelArgument),
  )
  .filter((b) => REMINDER_COMMANDS.has(routeCommand(b).command));

/** A readable store drawing on the sender's number, or an unreadable store. */
const storeFor = (number: CanonicalNumber): fc.Arbitrary<ReminderState> =>
  fc.oneof(
    { arbitrary: reminderStore([number]), weight: 4 },
    { arbitrary: fc.constant({ status: 'unreadable' } as const), weight: 1 },
  );

/** Clears every list and limit so the message reaches the reminder handling. */
const opened = (s: GatewayState): GatewayState => ({
  ...s,
  stopList: new Set(),
  rate: new Map(),
  settings: {
    ...s.settings,
    allowlistMode: false,
    perNumberLimit: 60,
    dailySendCap: 2000,
    ownNumber: null,
  },
});

interface Scenario {
  readonly number: CanonicalNumber;
  readonly address: string;
  readonly state: GatewayState;
}

/** The sender's address normalizes to `number` under the state's country code. */
const scenario: fc.Arbitrary<Scenario> = countryCode.chain((cc) =>
  fc.oneof(canonicalNumberIn(cc), canonicalNumber).chain((number) =>
    fc
      .tuple(gatewayState([number], storeFor(number)), formattingOf(number, cc), fc.boolean())
      .map(([s, f, open]) => {
        const state = { ...s, settings: { ...s.settings, defaultCountryCode: cc } };
        return { number, address: f.address, state: open ? opened(state) : state };
      }),
  ),
);

/** Today is the counters' day half of the time, so the Daily_Send_Cap counts. */
const todayFor = (state: GatewayState): fc.Arbitrary<string> =>
  fc.oneof(fc.constant(state.counters.dayKey), dayKeyArb);

const noTimer: NonNullable<PipelineDeps['startTimer']> = () => () => undefined;

interface Spied {
  readonly deps: PipelineDeps;
  readonly calls: () => number;
}

/** Real AnswerDeps with spies in place of the Answer_Service entry points. */
function spiedDeps(receivedAt: number): Spied {
  let calls = 0;
  const answer: AnswerDeps = {
    client: createMockClient([{ text: 'unused' }]),
    cache: createMemoryCache(),
    clock: () => receivedAt,
  };
  const deps: PipelineDeps = {
    answer,
    startTimer: noTimer,
    answerQuestion: () => {
      calls += 1;
      return Promise.resolve('SENTINEL answerQuestion');
    },
    checkScam: () => {
      calls += 1;
      return Promise.resolve('SENTINEL checkScam');
    },
  };
  return { deps, calls: () => calls };
}

const FORBIDDEN_PARTS: readonly (readonly string[])[] = LANGUAGES.flatMap((l) => [
  splitSms(GATEWAY_TEXTS[l].notAvailable),
  splitSms(FIXED_TEXTS[l].tryLater),
]);

const EARLY_EXITS: ReadonlySet<Outcome> = new Set<Outcome>([
  'ignored-paused',
  'ignored-automated',
  'ignored-own-number',
  'ignored-stopped',
  'ignored-not-allowed',
  'rate-limited',
  'send-capped',
]);

type Exit = 'paused' | 'automated' | 'own' | 'stopped' | 'not-allowed' | 'rate' | 'cap';
const EXITS: readonly Exit[] = ['paused', 'automated', 'own', 'stopped', 'not-allowed', 'rate', 'cap'];

interface ExitCase {
  readonly msg: InboundMessage;
  readonly state: GatewayState;
  readonly ctx: PipelineContext;
}

/** Forces the chosen early exit onto a scenario; earlier checks may also end the message. */
function forceExit(
  exit: Exit,
  { number, address, state }: Scenario,
  base: { body: string; receivedAt: number; today: string; automated: string; limit: number },
): ExitCase {
  const msg: InboundMessage = { id: 'm1', seq: 1, sender: address, body: base.body, receivedAt: base.receivedAt };
  const ctx: PipelineContext = { paused: false, today: base.today };
  const s = state.settings;
  switch (exit) {
    case 'paused':
      return { msg, state, ctx: { ...ctx, paused: true } };
    case 'automated':
      return { msg: { ...msg, sender: base.automated }, state, ctx };
    case 'own':
      return { msg, state: { ...state, settings: { ...s, ownNumber: number } }, ctx };
    case 'stopped':
      return { msg, state: { ...state, stopList: new Set([...state.stopList, number]) }, ctx };
    case 'not-allowed': {
      const allowlist =
        state.allowlist === 'unreadable'
          ? state.allowlist
          : new Set([...state.allowlist].filter((n) => n !== number));
      return { msg, state: { ...state, allowlist, settings: { ...s, allowlistMode: true } }, ctx };
    }
    case 'rate': {
      const times = Array.from({ length: base.limit }, () => base.receivedAt - 1);
      const rate = new Map(state.rate).set(number, times);
      return { msg, state: { ...state, rate, settings: { ...s, perNumberLimit: base.limit } }, ctx };
    }
    case 'cap': {
      const counters = { ...state.counters, dayKey: base.today, handed: s.dailySendCap };
      return { msg, state: { ...state, counters }, ctx };
    }
  }
}

const reminderWrites = (d: GatewayDecision) =>
  d.changes.filter((c) => c.type === 'reminder-add' || c.type === 'reminder-remove');

describe('reminder.pipeline reminder commands are local', () => {
  // Feature: sms-reminders, Property 19: Reminder commands are local and respect early exits
  it('5.9 9.9 REMIND, LIST and CANCEL never call the Answer_Service and give the same decision with and without a key', async () => {
    /** **Validates: Requirements 5.9, 9.9** */
    await fc.assert(
      fc.asyncProperty(
        scenario.chain((sc) => fc.tuple(fc.constant(sc), todayFor(sc.state))),
        reminderBody,
        timeArb,
        fc.boolean(),
        async ([{ address, state }, today], body, receivedAt, paused) => {
          const msg: InboundMessage = { id: 'm1', seq: 1, sender: address, body, receivedAt };
          const ctx: PipelineContext = { paused, today };
          const spied = spiedDeps(receivedAt);
          const withKey = await runGatewayPipeline(msg, state, ctx, spied.deps);
          const withoutKey = await runGatewayPipeline(msg, state, ctx, { answer: null, startTimer: noTimer });
          expect(spied.calls()).toBe(0);
          expect(withKey).toEqual(withoutKey);
          for (const forbidden of FORBIDDEN_PARTS) expect(withKey.parts).not.toEqual(forbidden);
        },
      ),
      REMINDER_PBT_OPTIONS,
    );
  });

  // Feature: sms-reminders, Property 19: Reminder commands are local and respect early exits
  it('5.10 a REMIND, LIST or CANCEL ended by an early exit adds no reminder and removes one only for CANCEL at the cap', async () => {
    /** **Validates: Requirements 5.10** */
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...EXITS),
        scenario.chain((sc) => fc.tuple(fc.constant(sc), todayFor(sc.state))),
        reminderBody,
        timeArb,
        automatedAddress,
        fc.integer({ min: 1, max: 5 }),
        async (exit, [sc, today], body, receivedAt, automated, limit) => {
          const c = forceExit(exit, sc, { body, receivedAt, today, automated, limit });
          const spied = spiedDeps(receivedAt);
          const decision = await runGatewayPipeline(c.msg, c.state, c.ctx, spied.deps);
          expect(spied.calls()).toBe(0);
          expect(EARLY_EXITS.has(decision.outcome)).toBe(true);
          const writes = reminderWrites(decision);
          expect(writes.filter((w) => w.type === 'reminder-add')).toEqual([]);
          const removes = writes.filter((w) => w.type === 'reminder-remove');
          const capRemoveAllowed = decision.command === 'CANCEL' && decision.outcome === 'send-capped';
          expect(removes.length).toBeLessThanOrEqual(capRemoveAllowed ? 1 : 0);
        },
      ),
      REMINDER_PBT_OPTIONS,
    );
  });
});
