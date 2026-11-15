// Property test for Activity_Entry privacy (task 9.7).
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildActivityEntry } from './gateway.activity.js';
import {
  GATEWAY_PBT_OPTIONS,
  anyBody,
  automatedAddress,
  countryCode,
  dayKeyArb,
  formattedNumber,
  gatewayState,
  sendReport,
  timeArb,
} from './gateway.arbitraries.js';
import { maskNumber, maskSender } from './gateway.number.js';
import { finalizeSend, runGatewayPipeline, type PipelineDeps } from './gateway.pipeline.js';
import type { ActivityEntry, CanonicalNumber, InboundMessage } from './gateway.types.js';

/** No-op backstop timer: never fires, cancel does nothing. */
const noTimer: NonNullable<PipelineDeps['startTimer']> = () => () => undefined;
const DEPS: PipelineDeps = { answer: null, startTimer: noTimer };

type Sender =
  | { readonly kind: 'phone'; readonly cc: string; readonly number: CanonicalNumber; readonly address: string }
  | { readonly kind: 'automated'; readonly cc: string; readonly address: string };

const phoneSender: fc.Arbitrary<Sender> = countryCode.chain((cc) =>
  formattedNumber(cc).map(
    (f): Sender => ({ kind: 'phone', cc, number: f.number, address: f.address }),
  ),
);
const automatedSender: fc.Arbitrary<Sender> = fc
  .tuple(countryCode, automatedAddress)
  .map(([cc, address]): Sender => ({ kind: 'automated', cc, address }));

/** Every run of 4 or more consecutive digits of `digits` contains a run of exactly 4. */
const digitRuns = (digits: string): string[] =>
  Array.from({ length: Math.max(0, digits.length - 3) }, (_, i) => digits.slice(i, i + 4));

/** The entry without receivedAt, whose digits are a time and may match by chance. */
const textFields = (entry: ActivityEntry): string =>
  JSON.stringify({ who: entry.who, command: entry.command, outcome: entry.outcome });

describe('Activity_Entry privacy', () => {
  // Feature: necromancer-sms-gateway, Property 28: Activity entries never reveal the number
  // **Validates: Requirements 14.8, 14.1, 14.2**
  it('Req 14.8: an Activity_Entry holds only the masked sender and no 4-digit run of the number', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .oneof(phoneSender, automatedSender)
          .chain((s) =>
            fc.tuple(fc.constant(s), gatewayState(s.kind === 'phone' ? [s.number] : [])),
          ),
        anyBody,
        timeArb,
        fc.boolean(),
        dayKeyArb,
        fc.option(sendReport(), { nil: null }),
        async ([sender, state], text, receivedAt, paused, today, report) => {
          const withCc = { ...state, settings: { ...state.settings, defaultCountryCode: sender.cc } };
          const msg: InboundMessage = { id: 'm1', seq: 1, sender: sender.address, body: text, receivedAt };

          const decision = await runGatewayPipeline(msg, withCc, { paused, today }, DEPS);
          const final = finalizeSend(
            decision,
            decision.parts.length > 0 ? report : null,
            withCc.counters,
            today,
          );
          const entry = buildActivityEntry(decision, final.outcome);

          expect(Object.keys(entry).sort()).toEqual(['command', 'outcome', 'receivedAt', 'who']);
          expect(entry.receivedAt).toBe(receivedAt);
          const fields = textFields(entry);

          if (sender.kind === 'phone') {
            expect(entry.who).toBe(maskNumber(sender.number));
            expect(fields).not.toContain(sender.number);
            expect(fields).not.toContain(sender.number.slice(1));
            const visible = entry.who + entry.command + entry.outcome;
            for (const run of digitRuns(sender.number.slice(1))) {
              expect(visible).not.toContain(run);
            }
          } else {
            expect(entry.who).toBe(maskSender(sender.address));
            const masked = maskSender(sender.address);
            // A raw address that is a word of the fixed command/outcome vocabulary is a coincidence.
            const vocabulary = entry.command + ' ' + entry.outcome;
            if (sender.address.length > 3 && sender.address !== masked && !vocabulary.includes(sender.address)) {
              expect(fields).not.toContain(JSON.stringify(sender.address).slice(1, -1));
              expect(entry.who).not.toContain(sender.address);
            }
          }
        },
      ),
      GATEWAY_PBT_OPTIONS,
    );
  });
});
