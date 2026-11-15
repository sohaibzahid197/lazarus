// T9_Decoder (Requirement 4): a left fold of `stepT9` (design C1), so the
// decoder and the Phone_Mock always agree. Pure, no browser API or clock.
import { initialT9State, pendingOf, stepT9, type KeyEvent, type T9Mode } from './t9.step';

export type DecodeResult =
  | { readonly ok: true; readonly text: string; readonly mode: T9Mode; readonly pending: string | null }
  | { readonly ok: false; readonly error: 'bad-time' };

/** True when every press time is a safe non-negative integer and times never decrease (4.6). */
function validTimes(events: readonly KeyEvent[]): boolean {
  let prev = 0;
  for (const e of events) {
    if (!Number.isSafeInteger(e.at) || e.at < prev) return false;
    prev = e.at;
  }
  return true;
}

/**
 * Decode Key_Events from a starting mode. Returns the committed text, the final
 * mode and the Pending_Character of the open group, with no final flush (4.5).
 */
export function decodeT9(events: readonly KeyEvent[], start: T9Mode): DecodeResult {
  if (!validTimes(events)) return { ok: false, error: 'bad-time' };
  const end = events.reduce(stepT9, initialT9State(start));
  return { ok: true, text: end.committed, mode: end.mode, pending: pendingOf(end) };
}
