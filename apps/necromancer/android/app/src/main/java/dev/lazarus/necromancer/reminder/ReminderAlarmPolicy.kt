package dev.lazarus.necromancer.reminder

import dev.lazarus.necromancer.gateway.GatewayLifecycle
import dev.lazarus.necromancer.gateway.GatewayLifecycle.AlarmMode

/**
 * Pure alarm decisions for the Reminder_Scheduler (Requirement 11.1, 11.2, 11.7).
 * No Android dependencies: callers pass in the SDK level, `canScheduleExactAlarms()`
 * and the service state, so JVM tests cover every branch directly.
 */
object ReminderAlarmPolicy {
  /** What the alarm receiver does when a reminder alarm or a reschedule event fires. */
  enum class TriggerAction {
    /** Gateway paused: re-arm the alarm only; no reminder is handed to the Delivery_Decision (11.7). */
    RESCHEDULE_ONLY,

    /** The JS loop is running: emit `onRemindersDue` so it runs the due reminders. */
    NOTIFY_LOOP,

    /** No running loop: start the Gateway_Service, which runs the due reminders on start. */
    START_SERVICE,
  }

  /**
   * Exact alarm while Exact_Alarm_Access is granted (always on API < 31), otherwise
   * inexact (11.1, 11.2). Shares the rule with the watchdog and restart alarms.
   */
  fun mode(sdkInt: Int, canExact: Boolean): AlarmMode =
    GatewayLifecycle.alarmMode(sdkInt, canExact)

  /**
   * Paused wins over everything (11.7). The loop is notified only when the service is
   * running and the JS loop is attached; any other state starts the service.
   */
  fun onTrigger(paused: Boolean, serviceRunning: Boolean, loopAttached: Boolean): TriggerAction =
    when {
      paused -> TriggerAction.RESCHEDULE_ONLY
      serviceRunning && loopAttached -> TriggerAction.NOTIFY_LOOP
      else -> TriggerAction.START_SERVICE
    }
}
