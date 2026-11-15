// Activity_Log functions (necromancer-sms-gateway design, "Activity_Entry";
// Requirements 7.6, 14.1–14.4). Pure: build masked entries and keep the
// newest ACTIVITY_LOG_MAX of them. No entry ever holds a full number or body.
import { maskNumber } from './gateway.number.js';
import type {
  ActivityEntry,
  GatewayDecision,
  Outcome,
  SenderIdentity,
} from './gateway.types.js';

/** Requirement 14.3: the Activity_Log keeps at most 200 entries. */
export const ACTIVITY_LOG_MAX = 200;

/**
 * Masked_Number for a Phone_Number, Masked_Sender for an Automated_Sender.
 * The automated identity already holds maskSender(address) (Requirement 14.2).
 */
function maskedWho(sender: SenderIdentity): string {
  return sender.kind === 'phone' ? maskNumber(sender.number) : sender.masked;
}

/** Requirements 7.6, 14.1, 14.2: one entry per recorded Outcome. */
export function buildActivityEntry(decision: GatewayDecision, outcome: Outcome): ActivityEntry {
  return {
    receivedAt: decision.receivedAt,
    who: maskedWho(decision.sender),
    command: decision.command ?? 'NONE',
    outcome,
  };
}

/**
 * Requirements 14.3, 14.4: add `entry`, order newest first by receive time and
 * keep the newest ACTIVITY_LOG_MAX. Among equal receive times the newly added
 * entry comes first, matching `ORDER BY received_at DESC, id DESC` in storage.
 */
export function trimActivityLog(
  log: readonly ActivityEntry[],
  entry: ActivityEntry,
): ActivityEntry[] {
  return [entry, ...log]
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, ACTIVITY_LOG_MAX);
}
