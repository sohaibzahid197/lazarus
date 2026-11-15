import 'server-only';
import {
  DEFAULT_SETTINGS,
  countInWindow,
  countersFor,
  localDayKey,
  type CanonicalNumber,
  type GatewayState,
} from '@lazarus/brain';

// Replies_Left (Requirements 19.6, 19.13): the Glossary formula, written only in
// terms of brain exports. The Crypt_App defines no limit, window or cap of its own.

/** Pakistan_Time offset in minutes, the argument the brain's `localDayKey` takes. */
const PAKISTAN_OFFSET_MINUTES = 300;
const MS_PER_MINUTE = 60_000;

export function repliesLeft(
  state: GatewayState,
  number: CanonicalNumber,
  serverTime: number,
): number {
  const s = DEFAULT_SETTINGS;
  const today = localDayKey(serverTime, PAKISTAN_OFFSET_MINUTES);
  if (countersFor(state.counters, today).handed >= s.dailySendCap) return 0;
  const times = state.rate.get(number) ?? [];
  const used = countInWindow(times, serverTime, s.rateWindowMinutes * MS_PER_MINUTE);
  return Math.max(0, s.perNumberLimit - used);
}
