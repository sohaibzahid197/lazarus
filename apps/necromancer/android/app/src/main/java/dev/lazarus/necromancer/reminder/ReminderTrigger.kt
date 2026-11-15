package dev.lazarus.necromancer.reminder

import android.content.Context
import android.util.Log
import dev.lazarus.necromancer.gateway.GatewayService
import dev.lazarus.necromancer.gateway.InboxQueue
import dev.lazarus.necromancer.reminder.ReminderAlarmPolicy.TriggerAction

/**
 * The one trigger path shared by [ReminderAlarmReceiver] and [ReminderEventsReceiver]
 * (Requirement 11.4, 11.6, 11.7). Call it off the main thread. It never throws.
 *
 * It re-arms the single alarm from the persisted Active_Reminders and then wakes the gateway
 * loop by [ReminderAlarmPolicy.onTrigger]. It decides nothing about any reminder: the loop
 * reloads the Reminder_Store, runs the due ones through the Delivery_Decision and re-arms.
 * Until then the scheduler's 5 s floor makes the alarm fire again, so a lost wake-up is retried.
 * An unreadable store is handled by the scheduler (alarm again in 60 s, 11.15).
 */
object ReminderTrigger {
  fun run(context: Context) {
    try {
      val app = context.applicationContext
      // Unreadable paused flag counts as paused, so nothing is sent (11.7).
      val paused = GatewayService.readPausedOrNull(app) ?: true
      ReminderScheduler.reschedule(app, paused)
      val attached = InboxQueue.get(app).isAttached && ReminderEvents.isListening
      when (ReminderAlarmPolicy.onTrigger(paused, GatewayService.isRunning, attached)) {
        TriggerAction.RESCHEDULE_ONLY -> Unit
        TriggerAction.NOTIFY_LOOP -> if (!ReminderEvents.notifyDue()) startService(app)
        TriggerAction.START_SERVICE -> startService(app)
      }
    } catch (e: RuntimeException) {
      Log.w(TAG, "ReminderTrigger: failed (${e.javaClass.simpleName})")
    }
  }

  /** The service runs the due reminders when its loop starts; a running service ignores a repeat start. */
  private fun startService(context: Context) {
    if (!GatewayService.start(context)) Log.w(TAG, "ReminderTrigger: start refused")
  }

  private const val TAG = "Lazarus"
}
