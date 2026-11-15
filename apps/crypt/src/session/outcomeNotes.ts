// Status_Notes for responses with 0 parts (Requirements 11.6 and 13.11).
import type { DeliveryOutcome, Outcome } from '@lazarus/brain';

/** Note for a 0-part `message` response (Requirement 11.6). */
export function noteForOutcome(outcome: Outcome | null): string {
  switch (outcome) {
    case 'ignored-stopped':
      return 'No reply: this number texted STOP. Send START to get replies again.';
    case 'rate-limited':
      return 'No reply: reply limit for this number reached. Press New session to keep testing.';
    case 'send-capped':
      return 'No reply: daily send limit reached. Press New session to keep testing.';
    default:
      return 'No reply.';
  }
}

/** Note for a 0-part `deliver` response with a Delivery_Outcome (Requirement 13.11). */
export function noteForDelivery(outcome: DeliveryOutcome): string {
  switch (outcome) {
    case 'reminder-stopped':
      return 'Reminder not sent: STOP is on.';
    case 'reminder-expired':
      return 'Reminder not sent: it was more than 1 hour late.';
    case 'reminder-capped':
      return 'Reminder not sent: daily send limit reached. Press New session to keep testing.';
    default:
      return 'Reminder not sent.';
  }
}
