import 'server-only';

// Ip_Rate_Limiter (Requirement 10): a pure sliding-window limiter keyed by Client_Ip.
// The module-level state cell lives in ipLimiter.store.ts.

/** Most Simulator_Requests one Client_Ip may make inside one window (10.3). */
export const IP_LIMIT = 30;
/** Sliding window length in milliseconds: 10 minutes (10.3). */
export const IP_WINDOW_MS = 600_000;
/** Most Client_Ips kept in memory per server instance (10.8, 10.9). */
export const IP_MAX_CLIENTS = 10_000;

const MAX_RETRY_AFTER_SEC = IP_WINDOW_MS / 1_000;

/** Ascending request times per Client_Ip. */
export type IpState = ReadonlyMap<string, readonly number[]>;

export type IpCheck =
  | { readonly accepted: true; readonly state: IpState }
  | { readonly accepted: false; readonly state: IpState; readonly retryAfterSec: number };

/**
 * Decides accept or reject for one request of `ip` at `now` (10.10).
 * Never mutates `state`; returns a new state instead.
 */
export function checkIp(state: IpState, ip: string, now: number): IpCheck {
  const pruned = prune(state, now);
  const times = pruned.get(ip) ?? [];

  if (times.length >= IP_LIMIT) {
    return { accepted: false, state: pruned, retryAfterSec: retryAfterSec(times, now) };
  }

  if (!pruned.has(ip) && pruned.size >= IP_MAX_CLIENTS) {
    evictOne(pruned);
  }
  pruned.set(ip, [...times, now]);
  return { accepted: true, state: pruned };
}

/** Keeps only times newer than `now − IP_WINDOW_MS`; drops Client_Ips with none left (10.8). */
function prune(state: IpState, now: number): Map<string, readonly number[]> {
  const cutoff = now - IP_WINDOW_MS;
  const next = new Map<string, readonly number[]>();
  for (const [ip, times] of state) {
    const kept = times.filter((t) => t > cutoff);
    if (kept.length > 0) next.set(ip, kept);
  }
  return next;
}

/** Seconds until the oldest of the window's times is IP_WINDOW_MS old, clamped to 1..600 (10.3). */
function retryAfterSec(times: readonly number[], now: number): number {
  const oldest = times[0] ?? now;
  const seconds = Math.ceil((oldest + IP_WINDOW_MS - now) / 1_000);
  return Math.min(MAX_RETRY_AFTER_SEC, Math.max(1, seconds));
}

/** Drops the Client_Ip whose newest time is oldest; ties go to the smallest string (10.9). */
function evictOne(state: Map<string, readonly number[]>): void {
  let victim: string | null = null;
  let victimNewest = Number.POSITIVE_INFINITY;
  for (const [ip, times] of state) {
    const newest = times[times.length - 1] ?? Number.NEGATIVE_INFINITY;
    if (newest < victimNewest || (newest === victimNewest && victim !== null && ip < victim)) {
      victim = ip;
      victimNewest = newest;
    }
  }
  if (victim !== null) state.delete(victim);
}
