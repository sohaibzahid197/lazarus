// Sanity checks for the session arbitraries: generated values meet their contract.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { countCodeUnits, detectEncoding, getPartLimits, joinSms } from '@lazarus/brain';
import { isSimulatorResponse } from '../../protocol/response.check';
import { CRYPT_PBT_OPTIONS } from '../pbt';
import {
  MAX_ARB_PARTS,
  currentActionArb,
  deliverResponseArb,
  messageResponseArb,
  responseArb,
  sessionStateArb,
  staleActionArb,
} from './session';

describe('session arbitraries', () => {
  it('responseArb passes isSimulatorResponse with part metadata from the brain', () => {
    fc.assert(
      fc.property(responseArb, (response) => {
        expect(isSimulatorResponse(response)).toBe(true);
        expect(isSimulatorResponse(JSON.parse(JSON.stringify(response)))).toBe(true);
        const texts = response.parts.map((p) => p.text);
        expect(texts.length).toBeLessThanOrEqual(MAX_ARB_PARTS);
        expect(response.encoding).toBe(detectEncoding(joinSms(texts)));
        const limits = getPartLimits(response.encoding);
        for (const [i, part] of response.parts.entries()) {
          expect(part.units).toBe(countCodeUnits(part.text, response.encoding));
          expect(part.limit).toBe(texts.length === 1 ? limits.single : limits.multi);
          if (texts.length >= 2) expect(part.text.startsWith(`(${String(i + 1)}/${String(texts.length)}) `)).toBe(true);
        }
      }),
      CRYPT_PBT_OPTIONS,
    );
  });

  it('message and deliver responses fill only their own fields', () => {
    fc.assert(
      fc.property(messageResponseArb, deliverResponseArb, (m, d) => {
        expect(m.kind).toBe('message');
        expect(m.outcome).not.toBeNull();
        expect(m.deliveryOutcome).toBeNull();
        expect(d.kind).toBe('deliver');
        expect(d.command).toBeNull();
        expect(d.outcome).toBeNull();
        if (d.deliveryOutcome !== 'reminder-sent') expect(d.parts).toHaveLength(0);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });

  it('sessionStateArb gives increasing bubble ids below nextBubbleId', () => {
    fc.assert(
      fc.property(sessionStateArb, (s) => {
        let previous = -1;
        for (const b of s.bubbles) {
          expect(b.id).toBeGreaterThan(previous);
          previous = b.id;
        }
        expect(s.nextBubbleId).toBeGreaterThan(previous);
        expect(Number.isInteger(s.repliesLeft)).toBe(true);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });

  it('staleActionArb never carries the state epoch and currentActionArb always does', () => {
    fc.assert(
      fc.property(staleActionArb, currentActionArb, (stale, current) => {
        expect(stale.action.epoch).not.toBe(stale.state.epoch);
        expect(current.action.epoch).toBe(current.state.epoch);
        if (current.action.type === 'response') expect(current.action.request).toBe(current.action.response.kind);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
