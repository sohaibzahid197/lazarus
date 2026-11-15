// Feature: crypt-ouija-simulator, Property 27: Client_Ips do not affect each other
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { checkIp, type IpState } from './ipLimiter';
import { ipRequestsArb, type IpRequest } from '../test/arbitraries/ip';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';

/** Accept or reject result and Retry-After seconds of one request. */
type Verdict = { readonly accepted: true } | { readonly accepted: false; readonly retryAfterSec: number };

/** Runs `requests` through `checkIp` from an empty state; returns the verdicts of `ip`'s requests in order. */
function verdictsFor(requests: readonly IpRequest[], ip: string): Verdict[] {
  let state: IpState = new Map();
  const verdicts: Verdict[] = [];
  for (const r of requests) {
    const result = checkIp(state, r.ip, r.at);
    state = result.state;
    if (r.ip !== ip) continue;
    verdicts.push(result.accepted ? { accepted: true } : { accepted: false, retryAfterSec: result.retryAfterSec });
  }
  return verdicts;
}

describe('Ip_Rate_Limiter isolation', () => {
  /** **Validates: Requirements 10.11** */
  it('Feature: crypt-ouija-simulator, Property 27: Client_Ips do not affect each other', () => {
    fc.assert(
      fc.property(ipRequestsArb, (requests) => {
        const ips = new Set(requests.map((r) => r.ip));
        for (const ip of ips) {
          const alone = requests.filter((r) => r.ip === ip);
          expect(verdictsFor(requests, ip)).toEqual(verdictsFor(alone, ip));
        }
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
