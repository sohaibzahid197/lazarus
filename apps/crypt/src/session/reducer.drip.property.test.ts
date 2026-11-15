// Feature: crypt-ouija-simulator, Property 35: Replies never interleave
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SimulatorResponse } from '../protocol/wire.types';
import { browserNowArb, responseArb, sessionStateArb } from '../test/arbitraries/session';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { REPLY_LIMIT_NOTE } from '../ui/texts';
import { noteForDelivery, noteForOutcome } from './outcomeNotes';
import { sessionReducer } from './session.reducer';
import type { SessionState } from './session.types';

type Op =
  | { readonly type: 'response'; readonly response: SimulatorResponse; readonly browserNow: number }
  | { readonly type: 'tick' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ type: fc.constant('response' as const), response: responseArb, browserNow: browserNowArb }),
  fc.constant<Op>({ type: 'tick' }),
);

const scenarioArb = fc.record({
  state: sessionStateArb,
  ops: fc.array(opArb, { maxLength: 20 }),
});

/** Independent model of the bubble texts one accepted response adds (11.6, 11.7, 13.11, 19.10). */
function expectedTexts(response: SimulatorResponse): string[] {
  const texts = response.parts.map((p) => p.text);
  if (response.kind === 'message') {
    if (texts.length === 0) return [noteForOutcome(response.outcome)];
    if (response.outcome === 'rate-limited' && texts.length === 1) return [...texts, REPLY_LIMIT_NOTE];
    return texts;
  }
  if (texts.length > 0) return texts;
  return response.deliveryOutcome === null ? [] : [noteForDelivery(response.deliveryOutcome)];
}

function apply(state: SessionState, op: Op): SessionState {
  if (op.type === 'tick') return sessionReducer(state, { type: 'drip-tick' });
  return sessionReducer(state, {
    type: 'response',
    epoch: state.epoch,
    request: op.response.kind,
    response: op.response,
    browserNow: op.browserNow,
  });
}

describe('Drip ordering', () => {
  /**
   * **Validates: Requirements 11.8**
   */
  it('Feature: crypt-ouija-simulator, Property 35: Replies never interleave', () => {
    fc.assert(
      fc.property(scenarioArb, ({ state, ops }) => {
        // Items already queued come first, then each response's items in arrival order.
        const expected: string[] = state.drip.map((d) => d.text);
        let s = state;
        for (const op of ops) {
          if (op.type === 'response') expected.push(...expectedTexts(op.response));
          s = apply(s, op);
          // Bubbles added so far are always a prefix of the expected concatenation.
          const added = s.bubbles.slice(state.bubbles.length).map((b) => b.text);
          expect(added).toEqual(expected.slice(0, added.length));
        }
        // Drain the queue: every expected item arrives, in order, nothing else.
        while (s.drip.length > 0) s = apply(s, { type: 'tick' });
        expect(s.bubbles.slice(0, state.bubbles.length)).toEqual(state.bubbles);
        expect(s.bubbles.slice(state.bubbles.length).map((b) => b.text)).toEqual(expected);
        const ids = s.bubbles.map((b) => b.id);
        ids.forEach((id, i) => {
          if (i > 0) expect(id).toBeGreaterThan(ids[i - 1] ?? -Infinity);
        });
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
