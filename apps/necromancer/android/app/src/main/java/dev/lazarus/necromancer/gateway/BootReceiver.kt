package dev.lazarus.necromancer.gateway

import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log

/**
 * Exported for `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED` (protected system broadcasts).
 * Not paused: start the Gateway_Service and arm the watchdog in 60 s (Requirement 10.1, 10.3, 10.5).
 * Paused: nothing (Requirement 9.5, 10.2, 10.4). Any other action is ignored.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action
    if (action != BootDecision.ACTION_BOOT_COMPLETED && action != BootDecision.ACTION_MY_PACKAGE_REPLACED) return
    val app = context.applicationContext
    val pending = goAsync()
    Thread {
      try {
        handle(app, action)
      } finally {
        pending.finish()
      }
    }.start()
  }

  private fun handle(context: Context, action: String) {
    val paused = GatewayService.readPausedOrNull(context)
    if (BootDecision.onBoot(action, paused) != BootDecision.Boot.START_AND_WATCH) return
    // Arm the watchdog first so a refused start still ends in the Operator notification.
    scheduleWatchdog(context)
    if (!GatewayService.isRunning && !GatewayService.start(context)) {
      Log.w(TAG, "BootReceiver: start refused")
    }
  }

  private fun scheduleWatchdog(context: Context) {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    val at = SystemClock.elapsedRealtime() + BootDecision.WATCHDOG_DELAY_MS
    val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
    val pending = WatchdogReceiver.pendingIntent(context)
    try {
      when (GatewayLifecycle.alarmMode(Build.VERSION.SDK_INT, canExact)) {
        GatewayLifecycle.AlarmMode.EXACT ->
          alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending)
        GatewayLifecycle.AlarmMode.INEXACT ->
          alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending)
      }
    } catch (e: SecurityException) {
      alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending)
    }
  }

  private companion object {
    const val TAG = "Lazarus"
  }
}
