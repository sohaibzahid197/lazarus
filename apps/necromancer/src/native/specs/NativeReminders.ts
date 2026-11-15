import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
/**
 * Reminder alarm control (Requirements 11.4, 11.6, 11.9). Kotlin never decides anything
 * about a reminder: it keeps one alarm for the earliest Due_Time and wakes the loop.
 * Nothing here carries a number or a Reminder_Text.
 */
export interface Spec extends TurboModule {
  /** Re-arms the single reminder alarm from MIN(due_at) of rows not handed, or cancels it. */
  reschedule(): Promise<void>;
  /** Arms the alarm 60 s from now (Requirement 11.15). */
  scheduleRetry(): Promise<void>;
  /** true on API 26–30; canScheduleExactAlarms() on API 31+. */
  getExactAlarmAccess(): Promise<boolean>;
  /** ACTION_REQUEST_SCHEDULE_EXACT_ALARM with package: URI; App info if it does not resolve. */
  openExactAlarmSettings(): Promise<void>;
  /** The reminder alarm fired (or a system event re-armed it) while the loop listens. */
  readonly onRemindersDue: CodegenTypes.EventEmitter<void>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('NativeReminders');
