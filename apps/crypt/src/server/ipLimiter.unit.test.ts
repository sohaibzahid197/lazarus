import { describe, expect, it } from 'vitest';
import { checkIp, IP_LIMIT, IP_MAX_CLIENTS, IP_WINDOW_MS, type IpState } from './ipLimiter';
import { limiterCell } from './ipLimiter.store';

const NOW = 1_767_225_600_000;
/** Base time well inside the window, so pruning keeps every stored entry. */
const BASE = NOW - IP_WINDOW_MS / 2;

function ipName(i: number): string {
  return `ip-${String(i).padStart(5, '0')}`;
}

/** A full state of IP_MAX_CLIENTS Client_Ips; `ipName(i)` has the single time `BASE + 1 + i`. */
function fullState(): Map<string, readonly number[]> {
  const state = new Map<string, readonly number[]>();
  for (let i = 0; i < IP_MAX_CLIENTS; i += 1) state.set(ipName(i), [BASE + 1 + i]);
  return state;
}

function snapshotOf(state: IpState): [string, number[]][] {
  return [...state].map(([ip, times]) => [ip, [...times]]);
}

describe('Ip_Rate_Limiter eviction (10.9)', () => {
  it('drops the Client_Ip whose newest time is the oldest when a new Client_Ip arrives at capacity', () => {
    const state = fullState();
    // ip-00000 has the oldest first time but a recent newest time, so it must stay.
    state.set(ipName(0), [BASE - 10, NOW - 1]);
    // ip-00001 now has the oldest newest time.
    const result = checkIp(state, 'new-client', NOW);

    expect(result.accepted).toBe(true);
    expect(result.state.size).toBe(IP_MAX_CLIENTS);
    expect(result.state.has(ipName(1))).toBe(false);
    expect(result.state.has(ipName(0))).toBe(true);
    expect(result.state.get('new-client')).toEqual([NOW]);
  });

  it('breaks a tie on the newest time by dropping the Client_Ip that sorts first', () => {
    const state = new Map<string, readonly number[]>();
    // Insert the larger string first so iteration order does not decide the tie.
    state.set('zeta', [BASE]);
    state.set('alpha', [BASE]);
    for (let i = 2; i < IP_MAX_CLIENTS; i += 1) state.set(ipName(i), [BASE + i]);
    expect(state.size).toBe(IP_MAX_CLIENTS);

    const result = checkIp(state, 'new-client', NOW);

    expect(result.accepted).toBe(true);
    expect(result.state.size).toBe(IP_MAX_CLIENTS);
    expect(result.state.has('alpha')).toBe(false);
    expect(result.state.has('zeta')).toBe(true);
    expect(result.state.has('new-client')).toBe(true);
  });

  it('evicts nobody when a stored Client_Ip makes a request at capacity', () => {
    const state = fullState();
    const result = checkIp(state, ipName(0), NOW);

    expect(result.accepted).toBe(true);
    expect(result.state.size).toBe(IP_MAX_CLIENTS);
    expect(result.state.has(ipName(0))).toBe(true);
    expect(result.state.get(ipName(0))).toEqual([BASE + 1, NOW]);
  });

  it('does not mutate the input state', () => {
    const state = fullState();
    const before = snapshotOf(state);

    checkIp(state, 'new-client', NOW);

    expect(snapshotOf(state)).toEqual(before);
  });
});

describe('Ip_Rate_Limiter window cap (10.3)', () => {
  it('rejects the 31st request in one window with Retry-After from 1 to 600', () => {
    let state: IpState = new Map();
    const first = NOW - 120_500;
    for (let i = 0; i < IP_LIMIT; i += 1) {
      const result = checkIp(state, 'unknown', first + i * 1_000);
      expect(result.accepted).toBe(true);
      state = result.state;
    }

    const result = checkIp(state, 'unknown', NOW);

    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    // The oldest time is 600,000 ms old at first + 600,000: 479.5 s from NOW, rounded up.
    expect(result.retryAfterSec).toBe(480);
    expect(result.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(result.retryAfterSec).toBeLessThanOrEqual(600);
    expect(result.state.get('unknown')).toHaveLength(IP_LIMIT);
  });
});

describe('limiterCell', () => {
  it('returns the state last set', () => {
    const original = limiterCell.get();
    const next: IpState = new Map([['a', [NOW]]]);
    limiterCell.set(next);
    expect(limiterCell.get()).toBe(next);
    limiterCell.set(original);
  });
});
