package dev.lazarus.necromancer.reminder
import android.app.AlarmManager
import android.content.Context
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import dev.lazarus.necromancer.device.SettingsIntents
import dev.lazarus.necromancer.gateway.GatewayService
import dev.lazarus.necromancer.specs.NativeRemindersSpec
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
/**
 * TurboModule `NativeReminders` (Requirements 11.4, 11.6, 11.9): re-arms the single reminder
 * alarm, arms the 60 s retry, reports and opens exact alarm access, and emits `onRemindersDue`.
 *
 * While the module is alive it sets [ReminderEvents.onRemindersDue], so the receivers can wake
 * the JS loop; [ReminderTrigger] only notifies when the loop is also attached to the inbox.
 * Alarm and storage calls run on one background thread. Rejections and logs carry only the
 * exception class, never a number, a Due_Time or a Reminder_Text.
 */
class ReminderModule(reactContext: ReactApplicationContext) : NativeRemindersSpec(reactContext) {
  private val appContext: Context = reactContext.applicationContext
  private val settings = SettingsIntents { reactApplicationContext.currentActivity ?: reactApplicationContext }
  private val dueListener: () -> Unit = { emitOnRemindersDue() }
  override fun initialize() {
    super.initialize()
    ReminderEvents.onRemindersDue = dueListener
  }
  override fun invalidate() {
    // Only our own listener: a reloaded module may already have set its own.
    if (ReminderEvents.onRemindersDue === dueListener) ReminderEvents.onRemindersDue = null
    super.invalidate()
  }
  override fun reschedule(promise: Promise) = io(promise) {
    // Unreadable paused flag counts as paused, as in ReminderTrigger (11.7).
    val paused = GatewayService.readPausedOrNull(appContext) ?: true
    ReminderScheduler.reschedule(appContext, paused) ?: throw AlarmNotArmedException()
    null
  }
  override fun scheduleRetry(promise: Promise) = io(promise) {
    ReminderScheduler.retryIn60s(appContext) ?: throw AlarmNotArmedException()
    null
  }
  override fun getExactAlarmAccess(promise: Promise) = io(promise) { hasExactAlarmAccess() }
  override fun openExactAlarmSettings(promise: Promise) {
    reactApplicationContext.runOnUiQueueThread {
      guard(promise) {
        settings.openExactAlarmSettings()
        promise.resolve(null)
      }
    }
  }
  private fun hasExactAlarmAccess(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val manager = appContext.getSystemService(AlarmManager::class.java) ?: return false
    return manager.canScheduleExactAlarms()
  }
  private fun io(promise: Promise, block: () -> Any?) {
    executor.execute { guard(promise) { promise.resolve(block()) } }
  }
  private fun guard(promise: Promise, work: () -> Unit) {
    try {
      work()
    } catch (e: Exception) {
      Log.w(TAG, "ReminderModule: call failed (${e.javaClass.simpleName})")
      promise.reject(ERROR_CODE, "NativeReminders failed (${e.javaClass.simpleName})")
    }
  }
  /** [ReminderScheduler] could not arm or cancel the alarm; it already logged why. */
  class AlarmNotArmedException : IllegalStateException()
  companion object {
    const val NAME = NativeRemindersSpec.NAME
    private const val TAG = "Lazarus"
    private const val ERROR_CODE = "E_REMINDERS"
    /** Process-wide so a reloaded module keeps one order for reschedule and retry. */
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "lazarus-reminders") }
  }
}
