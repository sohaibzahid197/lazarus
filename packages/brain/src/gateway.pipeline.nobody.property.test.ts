// Property test for the Gateway_Pipeline: bodies never reach stored data (task 9.8;
// sms-reminders task 10.3 allows the Reminder_Text inside reminder-add only).
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createMockClient } from './ai.mock.js';
import { ALIAS_TABLE } from './aliases.js';
import { createMemoryCache } from './answer.cache.js';
import type { AnswerDeps } from './answer.types.js';
import { buildActivityEntry } from './gateway.activity.js';
import {
  GATEWAY_PBT_OPTIONS,
  anyBody,
  countryCode,
  formattedNumber,
  gatewayState,
  sendReport,
  timeArb,
} from './gateway.arbitraries.js';
import { applyChanges, finalizeSend, runGatewayPipeline, type PipelineDeps } from './gateway.pipeline.js';
import { serializeChanges } from './gateway.state.js';
import { REMINDER_TEXTS } from './reminder.texts.js';
import { GATEWAY_TEXTS } from './gateway.texts.js';
import type { InboundMessage, PipelineContext, StateChange } from './gateway.types.js';

const AI_REPLY = 'A short answer.';

/** Fixed text the pipeline may send or store; the marker must not occur in it. */
const FIXED_HAYSTACK = (
  JSON.stringify(GATEWAY_TEXTS) +
  JSON.stringify(REMINDER_TEXTS) +
  [...ALIAS_TABLE.keys()].join(' ') +
  AI_REPLY
).toLowerCase();

/** No-op backstop timer: never fires, cancel does nothing. */
const noTimer: NonNullable<PipelineDeps['startTimer']> = () => () => undefined;

/** A distinctive marker: 12 to 20 lowercase letters. */
const markerToken: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
  minLength: 12,
  maxLength: 20,
});

/**
 * A body carrying the marker at the start, the end, or both, or a REMIND whose
 * Reminder_Text holds the marker (sms-reminders 14.6: the only allowed place).
 */
const markedBody = (marker: string): fc.Arbitrary<string> =>
  fc
    .tuple(anyBody, fc.constantFrom('end', 'start', 'both', 'remind'))
    .map(([text, where]) =>
      where === 'end'
        ? `${text} ${marker}`
        : where === 'start'
          ? `${marker} ${text}`
          : where === 'both'
            ? `${marker} ${text} ${marker}`
            : `REMIND at 8pm ${marker}`,
    );

type ReminderAdd = Extract<StateChange, { readonly type: 'reminder-add' }>;
const isReminderAdd = (c: StateChange): c is ReminderAdd => c.type === 'reminder-add';

/** A reminder-add with its Reminder_Text blanked: every other field must hold no body text. */
const withoutReminderText = (c: ReminderAdd): string =>
  JSON.stringify({ ...c, reminder: { ...c.reminder, text: '' } });

/** Decision fields other than `parts`, as JSON, with any Reminder_Text blanked. */
const withoutParts = (decision: {
  readonly parts: readonly string[];
  readonly changes: readonly StateChange[];
}): string => {
  const { parts: _parts, changes, ...rest } = decision;
  const blanked = changes.map((c) =>
    isReminderAdd(c) ? { ...c, reminder: { ...c.reminder, text: '' } } : c,
  );
  return JSON.stringify({ ...rest, changes: blanked });
};

/** A sender address with its Canonical_Number, so the state can hold it. */
const senderArb = countryCode.chain((cc) => formattedNumber(cc));



describe('Gateway_Pipeline keeps bodies out of stored data', () => {
  // Feature: necromancer-sms-gateway, Property 29: Bodies never reach stored data
  // **Validates: Requirements 14.7**
  it('Req 14.7: the marker never appears in changes, the Activity_Entry or the decision', async () => {
    await fc.assert(
      fc.asyncProperty(
        markerToken.chain((marker) => fc.tuple(fc.constant(marker), markedBody(marker))),
        senderArb.chain((sender) => fc.tuple(fc.constant(sender), gatewayState([sender.number]))),
        sendReport(),
        timeArb,
        fc.boolean(),
        fc.boolean(),
        async ([marker, text], [sender, state], report, receivedAt, paused, hasKey) => {
          fc.pre(!FIXED_HAYSTACK.includes(marker));
          const answer: AnswerDeps | null = hasKey
            ? {
                client: createMockClient([{ text: AI_REPLY }]),
                cache: createMemoryCache(),
                clock: () => receivedAt,
              }
            : null;
          const msg: InboundMessage = { id: 'm1', seq: 1, sender: sender.address, body: text, receivedAt };
          const today = state.counters.dayKey;
          const ctx: PipelineContext = { paused, today };

          const decision = await runGatewayPipeline(msg, state, ctx, { answer, startTimer: noTimer });
          const counters = applyChanges(state, decision.changes).counters;
          const final = finalizeSend(
            decision,
            decision.parts.length > 0 ? report : null,
            counters,
            today,
          );
          const entry = buildActivityEntry(decision, final.outcome);

          // The Reminder_Text may hold body text, but only inside the reminder-add of a REMIND.
          const adds = [...decision.changes, ...final.changes].filter(isReminderAdd);
          if (adds.length > 0) expect(decision.command).toBe('REMIND');
          expect(adds.length).toBeLessThanOrEqual(1);
          const stored = [
            serializeChanges(decision.changes.filter((c) => !isReminderAdd(c))),
            serializeChanges(final.changes.filter((c) => !isReminderAdd(c))),
            ...adds.map(withoutReminderText),
            JSON.stringify(entry),
            withoutParts(decision),
            JSON.stringify(decision.parts),
          ];
          for (const s of stored) expect(s.toLowerCase()).not.toContain(marker);
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
