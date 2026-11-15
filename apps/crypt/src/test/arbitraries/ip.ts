// Test-only arbitraries for the Ip_Rate_Limiter properties (Requirements 10.10, 10.11, 18.1).
import fc from 'fast-check';
import { IP_LIMIT, IP_WINDOW_MS } from '../../server/ipLimiter';

/** One Simulator_Request as the limiter sees it: a Client_Ip and the Server_Time. */
export interface IpRequest {
  readonly ip: string;
  readonly at: number;
}

/** Most Client_Ips one generated sequence uses (10.11). */
export const MAX_ARB_CLIENTS = 50;
/** Most requests one generated sequence holds (10.10, 10.11). */
export const MAX_ARB_REQUESTS = 500;

/**
 * 1 to 50 distinct Client_Ips. `unknown` (the Client_Ip of a request with no
 * `x-forwarded-for`, 10.12) is included about half the time, at index 0.
 */
export const ipPoolArb: fc.Arbitrary<readonly string[]> = fc
  .record({
    addrs: fc.uniqueArray(fc.ipV4(), { minLength: 0, maxLength: MAX_ARB_CLIENTS - 1 }),
    withUnknown: fc.boolean(),
  })
  .map(({ addrs, withUnknown }) => {
    const pool = withUnknown ? ['unknown', ...addrs] : addrs;
    return pool.length > 0 ? pool : ['unknown'];
  });

/**
 * Gap in milliseconds before a burst: 0, the window edges, any gap inside the
 * window, and gaps longer than the window so old times get pruned.
 */
const leadGapArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.constantFrom(IP_WINDOW_MS - 1, IP_WINDOW_MS, IP_WINDOW_MS + 1),
  fc.integer({ min: 1, max: IP_WINDOW_MS }),
  fc.integer({ min: IP_WINDOW_MS + 1, max: 10 * IP_WINDOW_MS }),
);

/** Gap in milliseconds between requests inside one burst; 45 of them fit in one window. */
const burstGapArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 1, max: 13_000 }),
);

/**
 * One request of a burst. `null` means the burst's hot Client_Ip, so one
 * Client_Ip passes IP_LIMIT inside a window while others interleave with it.
 */
const burstStepArb = fc.record({
  index: fc.oneof(
    { weight: 3, arbitrary: fc.constant(null) },
    { weight: 1, arbitrary: fc.nat({ max: MAX_ARB_CLIENTS - 1 }) },
  ),
  gap: burstGapArb,
});

const burstArb = fc.record({
  hot: fc.nat({ max: MAX_ARB_CLIENTS - 1 }),
  lead: leadGapArb,
  steps: fc.array(burstStepArb, { minLength: 1, maxLength: 2 * IP_LIMIT }),
});

/**
 * 0 to 500 requests with non-decreasing safe-integer times from 1 to 50
 * Client_Ips (including `unknown`), with bursts inside one window and gaps
 * longer than IP_WINDOW_MS between bursts.
 */
export const ipRequestsArb: fc.Arbitrary<readonly IpRequest[]> = fc
  .record({
    pool: ipPoolArb,
    start: fc.integer({ min: 0, max: 2_000_000_000_000 }),
    bursts: fc.array(burstArb, { minLength: 0, maxLength: 12 }),
  })
  .map(({ pool, start, bursts }) => {
    const requests: IpRequest[] = [];
    let at = start;
    for (const burst of bursts) {
      at += burst.lead;
      burst.steps.forEach((step, i) => {
        if (i > 0) at += step.gap;
        const index = step.index ?? burst.hot;
        requests.push({ ip: pool[index % pool.length] ?? 'unknown', at });
      });
    }
    return requests.slice(0, MAX_ARB_REQUESTS);
  });

/** Times of `requests` for one Client_Ip, in order. */
export function timesOf(requests: readonly IpRequest[], ip: string): number[] {
  return requests.filter((r) => r.ip === ip).map((r) => r.at);
}

/** True when some window of IP_WINDOW_MS holds more than IP_LIMIT of `times` (useful for checking coverage). */
export function exceedsLimit(times: readonly number[]): boolean {
  for (let i = IP_LIMIT; i < times.length; i += 1) {
    const first = times[i - IP_LIMIT];
    const last = times[i];
    if (first !== undefined && last !== undefined && last - first < IP_WINDOW_MS) return true;
  }
  return false;
}
