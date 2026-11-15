// Sanity checks for the limiter arbitraries: generated values meet their contract.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IP_WINDOW_MS } from '../../server/ipLimiter';
import { CRYPT_PBT_OPTIONS } from '../pbt';
import {
  MAX_ARB_CLIENTS,
  MAX_ARB_REQUESTS,
  exceedsLimit,
  ipPoolArb,
  ipRequestsArb,
  timesOf,
} from './ip';

describe('limiter arbitraries', () => {
  it('ipPoolArb gives 1 to 50 distinct Client_Ips', () => {
    fc.assert(
      fc.property(ipPoolArb, (pool) => {
        expect(pool.length).toBeGreaterThanOrEqual(1);
        expect(pool.length).toBeLessThanOrEqual(MAX_ARB_CLIENTS);
        expect(new Set(pool).size).toBe(pool.length);
      }),
      CRYPT_PBT_OPTIONS,
    );
  });

  it('ipRequestsArb gives 0 to 500 requests with non-decreasing safe-integer times', () => {
    fc.assert(
      fc.property(ipRequestsArb, (requests) => {
        expect(requests.length).toBeLessThanOrEqual(MAX_ARB_REQUESTS);
        expect(new Set(requests.map((r) => r.ip)).size).toBeLessThanOrEqual(MAX_ARB_CLIENTS);
        let previous = 0;
        for (const r of requests) {
          expect(Number.isSafeInteger(r.at)).toBe(true);
          expect(r.at).toBeGreaterThanOrEqual(previous);
          previous = r.at;
        }
      }),
      CRYPT_PBT_OPTIONS,
    );
  });

  it('ipRequestsArb covers bursts over the limit, `unknown` and gaps longer than the window', () => {
    const samples = fc.sample(ipRequestsArb, { numRuns: 200, seed: 42 });
    const ips = (rs: readonly { ip: string }[]) => new Set(rs.map((r) => r.ip));

    expect(samples.some((rs) => [...ips(rs)].some((ip) => exceedsLimit(timesOf(rs, ip))))).toBe(true);
    expect(samples.some((rs) => rs.some((r) => r.ip === 'unknown'))).toBe(true);
    expect(samples.some((rs) => ips(rs).size > 1)).toBe(true);
    expect(
      samples.some((rs) => rs.some((r, i) => i > 0 && r.at - (rs[i - 1]?.at ?? r.at) > IP_WINDOW_MS)),
    ).toBe(true);
  });
});
