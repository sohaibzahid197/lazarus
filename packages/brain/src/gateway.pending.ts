// Pending_Stop_Records (necromancer-sms-gateway design, "Pending_Stop_Records").
// A record holds no body: only the sender, the fixed STOP_MARKER and the
// receive time (Requirement 9.13, 14.13). The rowid `id` is a storage handle.
import { normalizeSender } from './gateway.number.js';
import type { GatewayDecision, GatewayState, Outcome, StateChange } from './gateway.types.js';
import type { Language } from './router.types.js';
import { STOP_MARKER } from './stopAliases.js';

export interface PendingStopRecord {
  readonly id: number; // SQLite rowid of the pending_stop row (handle, not a stored field)
  readonly sender: string; // Sender_Address exactly as Android reported it
  readonly marker: typeof STOP_MARKER;
  readonly receivedAt: number;
}

const RECORD_KEYS: readonly string[] = ['id', 'marker', 'receivedAt', 'sender'];
const DEFAULT_LANGUAGE: Language = 'en';

function hasExactKeys(value: object): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === RECORD_KEYS.length && keys.every((k, i) => k === RECORD_KEYS[i]);
}

/** Trust-boundary decoder: accepts only {id, sender, marker:'STOP', receivedAt}; any other key or marker → null. */
export function decodePendingStopRecord(raw: unknown): PendingStopRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  if (!hasExactKeys(raw)) return null;
  const r = raw as Record<string, unknown>;
  const { id, sender, marker, receivedAt } = r;
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return null;
  if (typeof sender !== 'string') return null;
  if (marker !== STOP_MARKER) return null;
  if (typeof receivedAt !== 'number' || !Number.isSafeInteger(receivedAt)) return null;
  return { id, sender, marker: STOP_MARKER, receivedAt };
}

/** Ascending receivedAt, ties by id. Returns a new array. */
export function orderPendingStops(records: readonly PendingStopRecord[]): PendingStopRecord[] {
  return [...records].sort((a, b) => a.receivedAt - b.receivedAt || a.id - b.id);
}

/**
 * Requirement 9.15. Runs only Automated_Sender, Own_Number and STOP handling.
 * Returns a decision with command 'STOP', 0 parts and outcome
 * 'ignored-automated' | 'ignored-own-number' (no changes) or 'stopped' (one stop-add).
 * Ignores paused, Allowlist_Mode, the Rate_Limiter and the Daily_Send_Cap (Requirement 3.2).
 */
export function applyPendingStop(record: PendingStopRecord, state: GatewayState): GatewayDecision {
  const sender = normalizeSender(record.sender, state.settings.defaultCountryCode);
  const decide = (outcome: Outcome, changes: readonly StateChange[]): GatewayDecision => ({
    messageId: `pending-stop:${record.id}`,
    receivedAt: record.receivedAt,
    sender,
    command: 'STOP',
    language: DEFAULT_LANGUAGE,
    outcome,
    parts: [],
    changes,
  });
  if (sender.kind !== 'phone') return decide('ignored-automated', []);
  if (state.settings.ownNumber !== null && sender.number === state.settings.ownNumber) {
    return decide('ignored-own-number', []);
  }
  return decide('stopped', [{ type: 'stop-add', number: sender.number }]);
}
