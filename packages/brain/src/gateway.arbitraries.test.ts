// Sanity checks for the gateway generators: sampled values meet the
// constraints the property tests rely on.
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { routeCommand } from './router.js';
import {
  GATEWAY_PBT_OPTIONS,
  apiKey,
  automatedAddress,
  canonicalNumber,
  countryCode,
  formattedNumber,
  gatewayState,
  pendingStopRecord,
  sendReport,
  settings,
  stopAliasBody,
} from './gateway.arbitraries.js';
import { isCanonicalNumber, isValidCountryCode, normalizeSender } from './gateway.number.js';

const SAMPLE = { numRuns: 200, seed: 42 } as const;

describe('gateway arbitraries', () => {
  it('runs properties at least 100 times', () => {
    expect(GATEWAY_PBT_OPTIONS.numRuns).toBeGreaterThanOrEqual(100);
  });

  it('canonical numbers and country codes are valid', () => {
    for (const n of fc.sample(canonicalNumber, SAMPLE)) expect(isCanonicalNumber(n)).toBe(true);
    for (const cc of fc.sample(countryCode, SAMPLE)) expect(isValidCountryCode(cc)).toBe(true);
  });

  it('formatted numbers normalize back to their number, in all three formats', () => {
    const pairs = fc.sample(
      countryCode.chain((cc) => formattedNumber(cc).map((f) => ({ cc, f }))),
      { numRuns: 500, seed: 7 },
    );
    for (const { cc, f } of pairs) {
      expect(normalizeSender(f.address, cc)).toEqual({ kind: 'phone', number: f.number });
    }
    expect(new Set(pairs.map((p) => p.f.format))).toEqual(
      new Set(['international', 'double-zero', 'national']),
    );
  });

  it('automated addresses are automated for any country code', () => {
    const cases = fc.sample(fc.tuple(automatedAddress, countryCode), SAMPLE);
    for (const [address, cc] of cases) expect(normalizeSender(address, cc).kind).toBe('automated');
  });

  it('settings stay within their ranges', () => {
    for (const s of fc.sample(settings, SAMPLE)) {
      expect(s.perNumberLimit).toBeGreaterThanOrEqual(1);
      expect(s.perNumberLimit).toBeLessThanOrEqual(60);
      expect(s.rateWindowMinutes).toBeGreaterThanOrEqual(1);
      expect(s.rateWindowMinutes).toBeLessThanOrEqual(1440);
      expect(s.dailySendCap).toBeGreaterThanOrEqual(1);
      expect(s.dailySendCap).toBeLessThanOrEqual(2000);
    }
  });

  it('gateway states keep handed within the cap and rate times sorted', () => {
    for (const state of fc.sample(gatewayState(), SAMPLE)) {
      expect(state.counters.handed).toBeLessThanOrEqual(state.settings.dailySendCap);
      expect(state.counters.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const times of state.rate.values()) {
        expect([...times]).toEqual([...times].sort((a, b) => a - b));
      }
    }
  });

  it('send reports carry the requested part count', () => {
    for (const r of fc.sample(sendReport(3), SAMPLE)) {
      if (r.status === 'done') expect(r.results).toHaveLength(3);
    }
  });

  it('API keys match the validator pattern', () => {
    for (const k of fc.sample(apiKey, SAMPLE)) expect(k).toMatch(/^[A-Za-z0-9_-]{30,64}$/);
  });

  it('STOP alias bodies route to STOP', () => {
    for (const b of fc.sample(stopAliasBody, SAMPLE)) expect(routeCommand(b).command).toBe('STOP');
  });

  it('pending stop records hold exactly id, sender, marker and receivedAt', () => {
    const own = '+923001234567';
    if (!isCanonicalNumber(own)) throw new Error('bad fixture');
    const records = fc.sample(pendingStopRecord(own, '92'), SAMPLE);
    for (const r of records) {
      expect(Object.keys(r).sort()).toEqual(['id', 'marker', 'receivedAt', 'sender']);
      expect(r.marker).toBe('STOP');
    }
    const kinds = new Set(
      records.map((r) => {
        const id = normalizeSender(r.sender, '92');
        if (id.kind === 'automated') return 'automated';
        return id.number === own ? 'own' : 'phone';
      }),
    );
    expect(kinds).toEqual(new Set(['automated', 'own', 'phone']));
  });
});
