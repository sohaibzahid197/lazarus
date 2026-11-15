package dev.lazarus.necromancer.reminder

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import dev.lazarus.necromancer.gateway.GatewayLifecycle.AlarmMode
import dev.lazarus.necromancer.store.LazarusDb

/**
 * Keeps at most 1 pending reminder alarm, for the earliest Due_Time of the Active_Reminders
 * not yet handed to the Sms_Sender (Requirement 11.1, 11.2, 11.3, 11.10, 11.13, 11.15).
 *
 * All Android calls sit behind [AlarmPort], and the store read behind [nextDue], so JVM tests
 * drive every branch with fakes. Logs are fixed strings: never a number, a Due_Time or a text.
 *
 * @param nextDue earliest `due_at` (epoch ms) of rows with `handed_at IS NULL`, `null` when none.
 *   Throws when the Reminder_Store cannot be read.
 * @param now wall clock in epoch ms (alarms use `RTC_WAKEUP`).
 */
class ReminderScheduler(
  private val alarms: AlarmPort,
  private val nextDue: () -> Long?,
  private val now: () -> Long = System::currentTimeMillis,
  private val log: (String) -> Unit = { Log.i(TAG, it) },
) {
  /** Android alarm calls, all on the single reminder PendingIntent. */
  interface AlarmPort {
    val sdkInt: Int
    /** `AlarmManager.canScheduleExactAlarms()`; only asked on API 31+. */
    fun canScheduleExact(): Boolean
    /** `setExactAndAllowWhileIdle(RTC_WAKEUP, atMs, pi)`; may throw [SecurityException]. */
    fun setExact(atMs: Long)
    /** `setAndAllowWhileIdle(RTC_WAKEUP, atMs, pi)`. */
    fun setInexact(atMs: Long)
    /** `cancel(pi)`. */
    fun cancel()
  }

  sealed interface Outcome {
    /** The single alarm now fires at [atMs] in [mode]. */
    data class Armed(val atMs: Long, val mode: AlarmMode) : Outcome
    /** No Active_Reminder remains; the pending alarm was cancelled. */
    data object Cancelled : Outcome
    /** The store could not be read; the alarm fires again at [atMs] = now + 60 s (11.15). */
    data class Retry(val atMs: Long, val mode: AlarmMode) : Outcome
  }

  /**
   * Re-arms the alarm for the earliest Due_Time, or cancels it when none remains (11.3).
   * The alarm is never set earlier than now + [MIN_REARM_DELAY_MS], or now +
   * [PAUSED_REARM_DELAY_MS] while [paused], so an overdue reminder that is kept unchanged
   * during a pause (11.7) cannot make the alarm fire again in a tight loop.
   */
  fun reschedule(paused: Boolean = false): Outcome {
    val due = try {
      nextDue()
    } catch (e: RuntimeException) {
      log("ReminderScheduler: store unreadable (${e.javaClass.simpleName})")
      return retryIn60s()
    }
    if (due == null) {
      alarms.cancel()
      log("ReminderScheduler: cancelled")
      return Outcome.Cancelled
    }
    val floor = now() + if (paused) PAUSED_REARM_DELAY_MS else MIN_REARM_DELAY_MS
    val at = maxOf(due, floor)
    return Outcome.Armed(at, arm(at))
  }

  /** Arms the single alarm exactly 60 s from now, replacing any pending one (11.10, 11.15). */
  fun retryIn60s(): Outcome {
    val at = now() + RETRY_DELAY_MS
    return Outcome.Retry(at, arm(at))
  }

  /** Exact when allowed, else inexact; a withdrawn access falls back to inexact (11.13). */
  private fun arm(at: Long): AlarmMode {
    val sdk = alarms.sdkInt
    val canExact = sdk < 31 || alarms.canScheduleExact()
    val mode = ReminderAlarmPolicy.mode(sdk, canExact)
    if (mode == AlarmMode.INEXACT) {
      alarms.setInexact(at)
      log("ReminderScheduler: armed inexact")
      return AlarmMode.INEXACT
    }
    return try {
      alarms.setExact(at)
      log("ReminderScheduler: armed exact")
      AlarmMode.EXACT
    } catch (e: SecurityException) {
      alarms.setInexact(at)
      log("ReminderScheduler: exact refused, armed inexact")
      AlarmMode.INEXACT
    }
  }

  /** [AlarmPort] over the real [AlarmManager] and one explicit, immutable PendingIntent. */
  private class AndroidAlarmPort(
    private val manager: AlarmManager,
    private val pending: PendingIntent,
  ) : AlarmPort {
    override val sdkInt: Int get() = Build.VERSION.SDK_INT
    override fun canScheduleExact(): Boolean =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()
    override fun setExact(atMs: Long) =
      manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending)
    override fun setInexact(atMs: Long) =
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pending)
    override fun cancel() = manager.cancel(pending)
  }

  companion object {
    const val ACTION_REMINDER_ALARM = "dev.lazarus.necromancer.reminder.REMINDER_ALARM"
    /** One request code for every reminder alarm, so a new alarm replaces the old one (11.10). */
    const val REMINDER_ALARM = 2003
    const val RETRY_DELAY_MS = 60_000L
    const val MIN_REARM_DELAY_MS = 5_000L
    const val PAUSED_REARM_DELAY_MS = 15 * 60_000L
    private const val TAG = "Lazarus"

    /** Explicit, immutable alarm target; `FLAG_UPDATE_CURRENT` keeps one PendingIntent. */
    fun pendingIntent(context: Context): PendingIntent {
      val intent = Intent(context, ReminderAlarmReceiver::class.java).setAction(ACTION_REMINDER_ALARM)
      return PendingIntent.getBroadcast(
        context, REMINDER_ALARM, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    /** Scheduler over the real AlarmManager and `lazarus.db`; `null` when there is no AlarmManager. */
    fun forContext(context: Context): ReminderScheduler? {
      val app = context.applicationContext
      val manager = app.getSystemService(AlarmManager::class.java) ?: run {
        Log.w(TAG, "ReminderScheduler: no AlarmManager")
        return null
      }
      return ReminderScheduler(AndroidAlarmPort(manager, pendingIntent(app)), { readNextDue(app) })
    }

    /** Re-arms from the persisted Active_Reminders (11.3, 11.6). Never throws. */
    fun reschedule(context: Context, paused: Boolean = false): Outcome? =
      runSafely { forContext(context)?.reschedule(paused) }

    /** Arms the alarm 60 s from now (11.15). Never throws. */
    fun retryIn60s(context: Context): Outcome? = runSafely { forContext(context)?.retryIn60s() }

    /**
     * `MIN(due_at)` of rows not yet handed (storage only, so Requirement 11.12 holds). Throws when
     * the Reminder_Store cannot be read, including a `reminder` table that is not ready.
     */
    private fun readNextDue(context: Context): Long? = LazarusDb.get(context).nextReminderDueAt()

    private inline fun runSafely(block: () -> Outcome?): Outcome? =
      try {
        block()
      } catch (e: RuntimeException) {
        Log.w(TAG, "ReminderScheduler: arming failed (${e.javaClass.simpleName})")
        null
      }
  }
}
