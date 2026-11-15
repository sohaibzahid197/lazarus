package dev.lazarus.necromancer.reminder

import android.util.Log

/**
 * Process-wide hook between the reminder receivers and `ReminderModule` (task 16.4).
 *
 * The module sets [onRemindersDue] while the JS gateway loop listens and clears it when the
 * React context goes away. The receivers only call [notifyDue]; they never touch React.
 * The listener carries no data: the loop reloads the Reminder_Store itself, so no number or
 * Reminder_Text passes through here.
 */
object ReminderEvents {
  /** Emits `onRemindersDue` to JS. Called on a receiver background thread. */
  @Volatile
  var onRemindersDue: (() -> Unit)? = null

  /** True while a listener is set, i.e. `ReminderModule` can reach the loop. */
  val isListening: Boolean get() = onRemindersDue != null

  /** Calls the listener; false when none is set or it threw, so the caller can start the service. */
  fun notifyDue(): Boolean {
    val listener = onRemindersDue ?: return false
    return try {
      listener()
      true
    } catch (e: RuntimeException) {
      Log.w(TAG, "ReminderEvents: notify failed (${e.javaClass.simpleName})")
      false
    }
  }

  private const val TAG = "Lazarus"
}
