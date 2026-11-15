package dev.lazarus.necromancer.reminder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Not exported; reached only through the explicit PendingIntent of [ReminderScheduler].
 * Runs [ReminderTrigger] under [goAsync] (Requirement 11.4, 11.7). Any other action is ignored.
 */
class ReminderAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ReminderScheduler.ACTION_REMINDER_ALARM) return
    val app = context.applicationContext
    val pending = goAsync()
    Thread({
      try {
        ReminderTrigger.run(app)
      } finally {
        pending.finish()
      }
    }, "lazarus-reminder-alarm").start()
  }
}
