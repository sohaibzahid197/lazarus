// Every UI string of the Ouija_Simulator that is not an SMS reply.
// SMS reply texts come only from @lazarus/brain (Requirement 7.6).

/** Requirement 6.5 and 6.7. */
export const CONNECTION_ERROR_TEXT =
  'The spirits did not answer. Check your connection and try again.';

/** Requirement 6.6 and 13.12. */
export const SESSION_RESET_TEXT = 'Your demo session was reset.';

/** Requirement 19.2j. */
export const NEW_SESSION_TEXT = 'New session started.';

/** Requirement 3.12 and 5.4. */
export const LENGTH_LIMIT_TEXT = 'Messages can be up to 480 characters.';

/** Requirement 19.10: added after a 1-part `rate-limited` reply. */
export const REPLY_LIMIT_NOTE =
  'Reply limit for this number reached. Press New session to keep testing.';

/** Requirement 19.9. */
export const NO_REPLIES_LEFT_HINT =
  'No replies left in this session. Press New session to keep testing.';

/** Requirement 13.10. */
export const REMINDERS_TAB_NOTE = 'Reminders last only while this tab is open.';

/** Requirement 12.5. */
export const STOP_BANNER_TEXT = 'STOP is on. Send START to get replies again.';

/** Requirement 19.7 and 19.8: `Replies left: n of 5`. */
export function repliesLeftText(n: number, total: number): string {
  return `Replies left: ${String(n)} of ${String(total)}`;
}

/** Requirement 13.10: count of Active_Reminders. */
export function activeRemindersText(count: number): string {
  return `Active reminders: ${String(count)}`;
}

/** Visible state labels of the Phone_Mock (Requirement 14.3–14.6). */
export const STATE_LABELS = {
  ALIVE: 'Alive',
  SENDING: 'Sending…',
  SLEEPING: 'Sleeping: STOP is on',
  ERROR: 'Error',
} as const;

export type PhoneStateName = keyof typeof STATE_LABELS;

/** Control labels and accessible names (Requirement 2.8, 16.3, 19.1). */
export const CONTROL_LABELS = {
  send: 'Send',
  clear: 'Clear',
  newSession: 'New session',
  keypadMode: 'Keypad',
  keyboardMode: 'Keyboard',
  reminderLabel: 'Reminder',
} as const;
