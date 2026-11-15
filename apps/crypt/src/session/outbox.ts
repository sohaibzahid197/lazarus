// Outbox: picks the next Simulator_Request (design C5; Requirements 13.3, 13.9).
// At most 1 request is in flight. A waiting message goes first, and due
// Reminders are held back while a message is waiting. Pure.
import { dueReminders } from './reminderPump';
import type { SessionState } from './session.types';

export type NextRequest =
  | { readonly type: 'message'; readonly body: string }
  | { readonly type: 'deliver'; readonly reminderId: string }
  | null;

export function nextRequest(
  s: SessionState,
  correctedNow: number,
  browserNow: number,
): NextRequest {
  if (s.inFlight !== null) return null;
  if (s.waitingMessage !== null) return { type: 'message', body: s.waitingMessage.body };
  const first = dueReminders(s, correctedNow, browserNow)[0];
  return first === undefined ? null : { type: 'deliver', reminderId: first };
}
