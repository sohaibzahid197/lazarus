package dev.lazarus.necromancer.gateway

/**
 * Pure boot and watchdog decisions (Requirement 10.1 to 10.5, 9.9).
 * No Android dependencies, so JVM tests cover them directly.
 *
 * An unreadable paused flag (`null`) counts as not paused, matching
 * [GatewayLifecycle.shouldRunOnStart]: the service starts, reads the flag again, and the
 * Operator is told to check the app if it still is not running.
 */
object BootDecision {
  const val ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED"
  const val ACTION_MY_PACKAGE_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED"

  /** Watchdog delay after boot or package replacement (Requirement 10.5). */
  const val WATCHDOG_DELAY_MS = 60_000L

  enum class Boot { START_AND_WATCH, NOTHING }
  enum class Watchdog { NOTIFY, NOTHING }

  /** Only the two system actions start anything; any other action is ignored. */
  fun onBoot(action: String?, paused: Boolean?): Boot =
    when {
      action != ACTION_BOOT_COMPLETED && action != ACTION_MY_PACKAGE_REPLACED -> Boot.NOTHING
      paused == true -> Boot.NOTHING
      else -> Boot.START_AND_WATCH
    }

  /** Notify only when the service is still not running and the Operator has not paused it. */
  fun watchdog(running: Boolean, paused: Boolean?): Watchdog =
    if (!running && paused != true) Watchdog.NOTIFY else Watchdog.NOTHING
}
