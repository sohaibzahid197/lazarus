// Feature: crypt-ouija-simulator, Property 26: At most 30 accepted per window
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exceedsLimit, ipRequestsArb } from '../test/arbitraries/ip';
import { CRYPT_PBT_OPTIONS } from '../test/pbt';
import { checkIp, IP_WINDOW_MS, type IpState } from './ipLimiter';

/** Expected Retry-After from the accepted times still inside the window (10.3). */
function expectedRetryAfter(accepted: readonly number[], now: number): number {
  const inWindow = accepted.filter((t) => t > now - IP_WINDOW_MS);
  const oldest = inWindow[0] ?? now;
  const seconds = Math.ceil((oldest + IP_WINDOW_MS - now) / 1_000);
  return Math.min(600, Math.max(1, seconds));
}

describe('Ip_Rate_Limiter window cap', () => {
  /**
   * **Validates: Requirements 10.3, 10.10**
   */
  it('Feature: crypt-ouija-simulator, Property 26: At most 30 accepted per window', () => {
    fc.assert(
      fc.property(ipRequestsArb, (requests) => {
        let state: IpState = new Map();
        const accepted = new Map<string, number[]>();

        for (const { ip, at } of requests) {
          const result = checkIp(state, ip, at);
          state = result.state;
          const mine = accepted.get(ip) ?? [];
          if (result.accepted) {
            mine.push(at);
            accepted.set(ip, mine);
          } else {
            expect(Number.isInteger(result.retryAfterSec)).toBe(true);
            expect(result.retryAfterSec).toBeGreaterThanOrEqual(1);
            expect(result.retryAfterSec).toBeLessThanOrEqual(600);
            expect(result.retryAfterSec).toBe(expectedRetryAfter(mine, at));
          }
        }

        for (const times of accepted.values()) {
          expect(exceedsLimit(times)).toBe(false);
        }
      }),
      CRYPT_PBT_OPTIONS,
    );
  });
});
