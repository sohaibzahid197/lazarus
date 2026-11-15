package dev.lazarus.necromancer.reminder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Exported for 3 protected system broadcasts: clock set, time zone changed and exact alarm
 * access changed (Requirement 11.6). Each re-arms the alarm from the persisted Active_Reminders
 * and wakes the loop through the same [ReminderTrigger] path as the alarm. Any other action,
 * which only another app could send, is ignored.
 */
class ReminderEventsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action !in ACTIONS) return
    val app = context.applicationContext
    val pending = goAsync()
    Thread({
      try {
        ReminderTrigger.run(app)
      } finally {
        pending.finish()
      }
    }, "lazarus-reminder-event").start()
  }

  companion object {
    /** Literal strings: the exact alarm constant only exists from API 31 (minSdk 26). */
    val ACTIONS = setOf(
      Intent.ACTION_TIME_CHANGED, // android.intent.action.TIME_SET
      Intent.ACTION_TIMEZONE_CHANGED,
      "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED",
    )
  }
}
