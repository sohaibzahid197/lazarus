import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canonicalNumber,
  canonicalNumberIn,
  countryCode,
  dayKeyArb,
  formattingOf,
  gatewayState,
  stopAliasBody,
  timeArb,
} from './gateway.arbitraries.js';
import { applyPendingStop, type PendingStopRecord } from './gateway.pending.js';
import { applyChanges, evaluateInbound, runGatewayPipeline } from './gateway.pipeline.js';
import type {
  CanonicalNumber,
  GatewayDecision,
  GatewayState,
  InboundMessage,
} from './gateway.types.js';
import { REMINDER_PBT_OPTIONS, reminderStore } from './reminder.arbitraries.js';
import type { Reminder, ReminderState } from './reminder.types.js';
import { routeCommand } from './router.js';
import { STOP_ALIAS_LIST, STOP_MARKER } from './stopAliases.js';

interface Scenario {
  readonly number: CanonicalNumber;
  readonly address: string;
  readonly state: GatewayState;
}

/** A readable store drawing on the sender's number, or an unreadable store. */
const storeFor = (number: CanonicalNumber): fc.Arbitrary<ReminderState> =>
  fc.oneof(
    { arbitrary: reminderStore([number]), weight: 4 },
    { arbitrary: fc.constant({ status: 'unreadable' } as const), weight: 1 },
  );

/** Sender is never the Own_Number; the address normalizes back to `number`. */
const scenario: fc.Arbitrary<Scenario> = countryCode
  .chain((cc) =>
    fc.oneof(canonicalNumberIn(cc), canonicalNumber).chain((number) =>
      fc
        .tuple(gatewayState([number], storeFor(number)), formattingOf(number, cc))
        .map(([s, f]) => ({
          number,
          address: f.address,
          state: { ...s, settings: { ...s.settings, defaultCountryCode: cc } },
        })),
    ),
  )
  .filter((s) => s.state.settings.ownNumber !== s.number);

const byId = (a: Reminder, b: Reminder): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const othersOf = (store: ReminderState, number: CanonicalNumber): Reminder[] =>
  store.status === 'ok' ? store.reminders.filter((r) => r.number !== number).sort(byId) : [];

/** Property 24 checks for one `stopped` decision. */
function expectStopRemovesAll(
  decision: GatewayDecision,
  state: GatewayState,
  number: CanonicalNumber,
): void {
  expect(decision.outcome).toBe('stopped');
  expect(decision.parts).toEqual([]);
  expect(decision.changes).toContainEqual({ type: 'stop-add', number });
  expect(decision.changes).toContainEqual({ type: 'reminder-remove-all', number });
  const next = applyChanges(state, decision.changes);
  expect(next.stopList.has(number)).toBe(true);
  if (state.reminders.status === 'unreadable') {
    expect(next.reminders).toEqual({ status: 'unreadable' });
    return;
  }
  expect(next.reminders.status).toBe('ok');
  if (next.reminders.status !== 'ok') return;
  expect(next.reminders.reminders.filter((r) => r.number === number)).toEqual([]);
  expect(othersOf(next.reminders, number)).toEqual(othersOf(state.reminders, number));
}

function liveStop(state: GatewayState, msg: InboundMessage, paused: boolean, today: string) {
  const step = evaluateInbound(msg, state, { paused, today }, routeCommand, false);
  expect(step.kind).toBe('final');
  return step.kind === 'final' ? step.decision : null;
}

describe('reminder.pipeline STOP removes reminders', () => {
  // Feature: sms-reminders, Property 24: STOP removes all reminders for that number
  it('8.3 live and paused STOP, every STOP alias, removes all reminders of that number only', () => {
    /** **Validates: Requirements 8.1, 8.2, 8.3** */
    fc.assert(
      fc.property(
        scenario,
        stopAliasBody,
        fc.boolean(),
        dayKeyArb,
        timeArb,
        ({ number, address, state }, body, paused, today, receivedAt) => {
          // The drawn alias form, plus every bare STOP alias, in the same state.
          for (const text of [body, ...STOP_ALIAS_LIST]) {
            const msg: InboundMessage = { id: 'm1', seq: 1, sender: address, body: text, receivedAt };
            const decision = liveStop(state, msg, paused, today);
            if (decision !== null) expectStopRemovesAll(decision, state, number);
          }
        },
      ),
      REMINDER_PBT_OPTIONS,
    );
  });

  // Feature: sms-reminders, Property 24: STOP removes all reminders for that number
  it('8.3 live STOP through runGatewayPipeline removes all reminders of that number only', async () => {
    /** **Validates: Requirements 8.1, 8.2, 8.3** */
    await fc.assert(
      fc.asyncProperty(
        scenario,
        stopAliasBody,
        fc.boolean(),
        dayKeyArb,
        timeArb,
        async ({ number, address, state }, body, paused, today, receivedAt) => {
          const msg: InboundMessage = { id: 'm1', seq: 1, sender: address, body, receivedAt };
          const decision = await runGatewayPipeline(msg, state, { paused, today }, { answer: null });
          expectStopRemovesAll(decision, state, number);
        },
      ),
      REMINDER_PBT_OPTIONS,
    );
  });

  // Feature: sms-reminders, Property 24: STOP removes all reminders for that number
  it('8.3 a Pending_Stop_Record STOP removes all reminders of that number only', () => {
    /** **Validates: Requirements 8.1, 8.2, 8.3** */
    fc.assert(
      fc.property(scenario, fc.nat(), timeArb, ({ number, address, state }, id, receivedAt) => {
        const record: PendingStopRecord = { id, sender: address, marker: STOP_MARKER, receivedAt };
        expectStopRemovesAll(applyPendingStop(record, state), state, number);
      }),
      REMINDER_PBT_OPTIONS,
    );
  });
});
