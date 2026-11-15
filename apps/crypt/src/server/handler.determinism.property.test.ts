// Feature: crypt-ouija-simulator, Property 19: Responses are deterministic
import fc from 'fast-check';
import { AI_ERROR_KINDS, type AiErrorKind } from '@lazarus/brain';
import { describe, expect, it } from 'vitest';
import { aiReplyArb, messageBodyArb } from '../test/arbitraries/request';
import { snapshotAtArb } from '../test/arbitraries/snapshot';
import { headerLines, makeHandler, post, type HarnessOptions } from '../test/handlerHarness';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';

/** The mock AI behaviour of one run: a reply text or an AI error kind. */
type AiBehaviour = { readonly reply: string } | { readonly error: AiErrorKind };

const aiBehaviourArb: fc.Arbitrary<AiBehaviour> = fc.oneof(
  { weight: 4, arbitrary: aiReplyArb.map((reply): AiBehaviour => ({ reply })) },
  { weight: 1, arbitrary: fc.constantFrom(...AI_ERROR_KINDS).map((error): AiBehaviour => ({ error })) },
);

function optionsFor(serverTime: number, ai: AiBehaviour, withKey: boolean): HarnessOptions {
  return {
    now: serverTime,
    withKey,
    ...('error' in ai ? { aiError: ai.error } : { aiReply: ai.reply }),
  };
}

describe('Responses are deterministic', () => {
  /**
   * **Validates: Requirements 7.14**
   */
  it('Feature: crypt-ouija-simulator, Property 19: Responses are deterministic', async () => {
    await fc.assert(
      fc.asyncProperty(
        snapshotAtArb,
        messageBodyArb,
        aiBehaviourArb,
        fc.boolean(),
        async ({ serverTime, snapshot }, body, ai, withKey) => {
          const request = { type: 'message', body, snapshot } as const;
          // Two handlers with fresh state (own limiter cell, mock client and cache).
          const first = await post(makeHandler(optionsFor(serverTime, ai, withKey)).handler, request);
          const second = await post(makeHandler(optionsFor(serverTime, ai, withKey)).handler, request);

          expect(first.status).toBe(200);
          expect(second.status).toBe(first.status);
          expect(second.text).toBe(first.text);
          expect(headerLines(second.headers)).toEqual(headerLines(first.headers));
        },
      ),
      CRYPT_PBT_OPTIONS,
    );
  });
});
