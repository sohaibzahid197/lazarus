// Feature: crypt-ouija-simulator, Property 22: No number or key in successful responses
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import {
  PHONE_FORMS,
  SIMULATOR_DIGITS,
  SIMULATOR_NUMBER_TEXT,
  aiReplyArb,
  messageBodyArb,
} from '../test/arbitraries/request';
import { snapshotAtArb } from '../test/arbitraries/snapshot';
import { collectStrings, headerLines, makeHandler, post } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS, TEST_KEY } from '../test/pbt';

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table'] as const;

/** Reminder_Texts (1..140 units) that carry a number, its digits, the key or a phone form (17.2). */
const sensitiveReminderTextArb: fc.Arbitrary<string> = fc
  .constantFrom(SIMULATOR_NUMBER_TEXT, SIMULATOR_DIGITS, TEST_KEY, ...PHONE_FORMS)
  .map((s) => `call ${s} now`);

/** A valid snapshot whose Reminder_Texts may be replaced by sensitive ones. */
const privacySnapshotAtArb = snapshotAtArb.chain(({ serverTime, snapshot }) =>
  fc
    .array(fc.option(sensitiveReminderTextArb, { nil: undefined }), {
      minLength: snapshot.reminders.length,
      maxLength: snapshot.reminders.length,
    })
    .map((texts) => {
      const s: SessionSnapshot = {
        ...snapshot,
        reminders: snapshot.reminders.map((r, i) => ({ ...r, text: texts[i] ?? r.text })),
      };
      return { serverTime, snapshot: s };
    }),
);

/** A valid request: a message, or a deliver for a Reminder of the snapshot or an absent id. */
const requestArb = privacySnapshotAtArb.chain(({ serverTime, snapshot }) => {
  const ids = snapshot.reminders.map((r) => r.id);
  const deliverIdArb = ids.length > 0 ? fc.oneof(fc.constantFrom(...ids), fc.constant('r:absent')) : fc.constant('r:absent');
  return fc.record({
    serverTime: fc.constant(serverTime),
    request: fc.oneof(
      { weight: 3, arbitrary: messageBodyArb.map((body) => ({ type: 'message' as const, body, snapshot })) },
      { weight: 1, arbitrary: deliverIdArb.map((reminderId) => ({ type: 'deliver' as const, reminderId, snapshot })) },
    ),
  });
});

describe('No number or key in successful responses', () => {
  let spies: MockInstance[] = [];

  beforeEach(() => {
    spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
  });

  afterEach(() => {
    for (const s of spies) s.mockRestore();
  });

  /**
   * **Validates: Requirements 1.11, 7.11, 9.5, 9.6, 17.1, 17.2, 17.4**
   */
  it('Feature: crypt-ouija-simulator, Property 22: No number or key in successful responses', async () => {
    await fc.assert(
      fc.asyncProperty(requestArb, aiReplyArb, fc.boolean(), async ({ serverTime, request }, aiReply, withKey) => {
        const h = makeHandler({ now: serverTime, aiReply, withKey });
        const res = await post(h.handler, request);
        expect(res.status).toBe(200);

        const headers = headerLines(res.headers);
        const strings = collectStrings(res.json);
        // Whole serialized body and headers: no Simulator_Number (with or without +) and no key.
        for (const text of [res.text, ...headers]) {
          expect(text).not.toContain(SIMULATOR_NUMBER_TEXT);
          expect(text).not.toContain(SIMULATOR_DIGITS);
          // TEST_KEY is the Gemini_Api_Key only when one is configured; without a key it is plain text.
          if (withKey) expect(text).not.toContain(TEST_KEY);
        }
        // JSON string values: no phone form and no 7-digit run (numbers excluded, 17.4).
        for (const s of [...strings, ...headers]) {
          for (const form of PHONE_FORMS) expect(s).not.toContain(form);
          expect(s).not.toMatch(/\d{7}/);
        }
        expect(res.headers.has('set-cookie')).toBe(false);
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
