// Gateway checks shared by the Gateway_Pipeline and the Delivery_Decision
// (sms-reminders design, "gateway.checks.ts"). Kept apart to avoid an import cycle.
import type { CanonicalNumber, GatewayState, StateChange } from './gateway.types.js';

/**
 * STOP always wins: the Stop_List add and the removal of every Reminder of the
 * number in one change list, whether or not the store lists one (8.1, 8.2).
 */
export function stopChanges(number: CanonicalNumber): readonly StateChange[] {
  return [
    { type: 'stop-add', number },
    { type: 'reminder-remove-all', number },
  ];
}

/** Allowlist_Mode blocks the number: mode on and not listed, or the list is unreadable (4.1, 4.8, 4.9, 4.11). */
export function notAllowed(number: CanonicalNumber, state: GatewayState): boolean {
  if (!state.settings.allowlistMode) return false;
  return state.allowlist === 'unreadable' || !state.allowlist.has(number);
}
