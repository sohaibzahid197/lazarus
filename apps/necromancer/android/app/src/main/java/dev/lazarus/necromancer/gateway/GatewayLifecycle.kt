package dev.lazarus.necromancer.gateway

/**
 * Pure lifecycle decisions for the Gateway_Service (Requirement 9.1, 9.4, 9.5).
 * No Android dependencies, so JVM tests cover them directly.
 */
object GatewayLifecycle {
  /** Restart alarm delay after `onTaskRemoved` / `onDestroy` (Requirement 9.4). */
  const val RESTART_DELAY_MS = 5_000L

  /** Upper bound for the processing wake lock, so a lost release can never drain the battery. */
  const val PROCESSING_WAKE_LOCK_MAX_MS = 10 * 60_000L

  enum class AlarmMode { EXACT, INEXACT }

  /**
   * Android stopped or lost the service: ask for a restart unless the Operator paused it.
   * An unreadable paused flag (`null`) still schedules; [RestartReceiver] and
   * [shouldRunOnStart] read the flag again before anything runs.
   */
  fun shouldScheduleRestart(paused: Boolean?): Boolean = paused != true

  /**
   * `onStartCommand`: run the gateway loop unless the Operator paused it (Requirement 9.5).
   * An unreadable flag (`null`) runs, matching the restart decision.
   */
  fun shouldRunOnStart(paused: Boolean?): Boolean = paused != true

  /**
   * Exact alarms only when the OS allows them (API < 31, or `canScheduleExactAlarms()`);
   * the app declares no `SCHEDULE_EXACT_ALARM`, so most API 31+ phones get INEXACT.
   */
  fun alarmMode(sdkInt: Int, canScheduleExact: Boolean): AlarmMode =
    if (sdkInt < 31 || canScheduleExact) AlarmMode.EXACT else AlarmMode.INEXACT

  /** `getServiceStatus()` wire value: paused wins over running. */
  fun serviceStatus(running: Boolean, paused: Boolean): String =
    when {
      paused -> "paused"
      running -> "running"
      else -> "stopped"
    }
}
