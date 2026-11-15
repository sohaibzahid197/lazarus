// Feature: crypt-ouija-simulator, Property 21: Part metadata matches the returned text
import fc from 'fast-check';
import { countCodeUnits, detectEncoding, getPartLimits, joinSms } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../protocol/snapshot.types';
import type { SimulatorResponse } from '../protocol/wire.types';
import { aiReplyArb, messageBodyArb, PHONE_FORMS, SIMULATOR_DIGITS } from '../test/arbitraries/request';
import { snapshotAtArb } from '../test/arbitraries/snapshot';
import { makeHandler, post } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS, TEST_KEY } from '../test/pbt';

/** Long AI replies (GSM-7 or with Urdu script) so answers split into 2 to 4 parts. */
const longReplyArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(
      fc.constantFrom(
        'Keep tomatoes in a cool, dry place out of direct sun.',
        'Water the plants early in the morning.',
        'ٹماٹر کو ٹھنڈی جگہ پر رکھیں۔',
        TEST_KEY,
        SIMULATOR_DIGITS,
        ...PHONE_FORMS,
      ),
      { minLength: 3, maxLength: 14 },
    ),
  )
  .map(([words]) => words.join(' '));

const replyArb: fc.Arbitrary<string> = fc.oneof(aiReplyArb, longReplyArb);

type RequestBody =
  | { readonly type: 'message'; readonly body: string; readonly snapshot: SessionSnapshot }
  | { readonly type: 'deliver'; readonly reminderId: string; readonly snapshot: SessionSnapshot };

/** A `message` request, or a `deliver` for a Reminder of the snapshot (or an absent id). */
function requestArb(snapshot: SessionSnapshot): fc.Arbitrary<RequestBody> {
  const ids = snapshot.reminders.map((r) => r.id);
  const idArb = ids.length === 0 ? fc.constant('r:absent') : fc.oneof(fc.constantFrom(...ids), fc.constant('r:absent'));
  // A snapshot with STOP off and no rate or cap use, so QUESTIONs reach the AI and long replies split.
  const open: SessionSnapshot = {
    ...snapshot,
    stopped: false,
    receiveTimes: [],
    slowDownAt: null,
    counters: { ...snapshot.counters, handed: 0 },
  };
  return fc.oneof(
    { weight: 3, arbitrary: messageBodyArb.map((body): RequestBody => ({ type: 'message', body, snapshot })) },
    {
      weight: 3,
      arbitrary: fc
        .constantFrom('How can I keep tomatoes fresh longer?', 'آج موسم کیسا ہے؟', 'kya aaj barish hogi?')
        .map((body): RequestBody => ({ type: 'message', body, snapshot: open })),
    },
    { weight: 1, arbitrary: idArb.map((reminderId): RequestBody => ({ type: 'deliver', reminderId, snapshot })) },
  );
}

const PREFIX = /^\((\d+)\/(\d+)\) /;

describe('Part metadata matches the returned text', () => {
  /**
   * **Validates: Requirements 7.4, 7.5, 17.3**
   */
  it('Feature: crypt-ouija-simulator, Property 21: Part metadata matches the returned text', async () => {
    await fc.assert(
      fc.asyncProperty(
        snapshotAtArb.chain(({ serverTime, snapshot }) =>
          fc.record({ serverTime: fc.constant(serverTime), request: requestArb(snapshot) }),
        ),
        replyArb,
        // Mostly with the fake key, so QUESTIONs get AI answers; sometimes without (Try_Later_Text).
        fc.oneof({ weight: 3, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) }),
        async ({ serverTime, request }, aiReply, withKey) => {
          const h = makeHandler({ now: serverTime, aiReply, withKey });
          const res = await post(h.handler, request);
          expect(res.status).toBe(200);

          const got = res.json as SimulatorResponse;
          const texts = got.parts.map((p) => p.text);
          const n = texts.length;
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(4);

          // Encoding, units and limit are computed on the returned (sanitized) text.
          expect(got.encoding).toBe(detectEncoding(joinSms(texts)));
          const { single, multi } = getPartLimits(got.encoding);
          got.parts.forEach((p, i) => {
            expect(p.units).toBe(countCodeUnits(p.text, got.encoding));
            expect(p.limit).toBe(n === 1 ? single : multi);
            const m = PREFIX.exec(p.text);
            if (n >= 2) {
              expect(m?.[0]).toBe(`(${String(i + 1)}/${String(n)}) `);
            } else {
              expect(m).toBeNull();
            }
          });
        },
      ),
      CRYPT_PBT_OPTIONS,
    );
  });
});
