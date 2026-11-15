package dev.lazarus.necromancer.device

import android.provider.Settings

/**
 * One settings screen to try. Plain data, so the fallback chains and the choice logic
 * run in JVM tests without Android. [component] is `package/class` for explicit
 * targets such as the HyperOS Autostart page; [withPackageUri] adds `package:<app>`.
 */
data class SettingsTarget(
  val action: String?,
  val component: Pair<String, String>? = null,
  val withPackageUri: Boolean = false,
)

/** Fallback chains, first entry preferred. Requirements 11.6, 11.7, 12.2–12.5, 12.11, 13.7. */
object SettingsTargets {
  const val MIUI_SECURITY_CENTER = "com.miui.securitycenter"
  const val MIUI_AUTOSTART_ACTIVITY = "com.miui.permcenter.autostart.AutoStartManagementActivity"

  val APP_INFO = SettingsTarget(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, withPackageUri = true)
  val SYSTEM_SETTINGS = SettingsTarget(Settings.ACTION_SETTINGS)

  val appInfo: List<SettingsTarget> = listOf(APP_INFO, SYSTEM_SETTINGS)

  val autostart: List<SettingsTarget> = listOf(
    SettingsTarget(action = null, component = MIUI_SECURITY_CENTER to MIUI_AUTOSTART_ACTIVITY),
    APP_INFO,
    SYSTEM_SETTINGS,
  )

  val batteryOptimisation: List<SettingsTarget> = listOf(
    SettingsTarget(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, withPackageUri = true),
    SettingsTarget(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
    APP_INFO,
  )

  val airplane: List<SettingsTarget> = listOf(
    SettingsTarget(Settings.ACTION_AIRPLANE_MODE_SETTINGS),
    SettingsTarget(Settings.ACTION_WIRELESS_SETTINGS),
    SYSTEM_SETTINGS,
  )

  val mobileNetwork: List<SettingsTarget> = listOf(
    SettingsTarget(Settings.ACTION_NETWORK_OPERATOR_SETTINGS),
    SettingsTarget(Settings.ACTION_WIRELESS_SETTINGS),
    SYSTEM_SETTINGS,
  )

  /**
   * Indexes of the targets worth trying, in order: those [resolves] accepts. The caller
   * starts them one by one and stops at the first that opens; index 0 means the
   * preferred screen opened, anything else means a fallback did.
   */
  fun candidates(chain: List<SettingsTarget>, resolves: (SettingsTarget) -> Boolean): List<Int> =
    chain.indices.filter { resolves(chain[it]) }
}
