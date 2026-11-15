// Feature: crypt-ouija-simulator, Property 28: Limiter state stays bounded
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkIp, IP_LIMIT, IP_MAX_CLIENTS, IP_WINDOW_MS, type IpState } from './ipLimiter';
import { ipRequestsArb } from '../test/arbitraries/ip';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';

describe('Ip_Rate_Limiter bounded state', () => {
  /**
   * **Validates: Requirements 10.8**
   */
  it('Feature: crypt-ouija-simulator, Property 28: Limiter state stays bounded', () => {
    fc.assert(
      fc.property(ipRequestsArb, (requests) => {
        let state: IpState = new Map();
        for (const { ip, at } of requests) {
          state = checkIp(state, ip, at).state;
          expect(state.size).toBeLessThanOrEqual(IP_MAX_CLIENTS);
          for (const times of state.values()) {
            expect(times.length).toBeGreaterThan(0);
            expect(times.length).toBeLessThanOrEqual(IP_LIMIT);
            for (const t of times) expect(t).toBeGreaterThan(at - IP_WINDOW_MS);
          }
        }
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
