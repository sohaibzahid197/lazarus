package dev.lazarus.necromancer.device

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.os.Build

/**
 * Opens the system settings screens used by the Setup_Screen, Permission_Screen and
 * heartbeat fix buttons. Each method walks a [SettingsTargets] chain: a target is
 * tried only when `resolveActivity` finds it (the manifest `<queries>` makes these
 * visible on Android 11+), and a target whose `startActivity` still throws is skipped.
 *
 * [contextProvider] lets the caller pass the current Activity when there is one;
 * otherwise the intent gets `FLAG_ACTIVITY_NEW_TASK`.
 */
class SettingsIntents(private val contextProvider: () -> Context) {
  constructor(context: Context) : this({ context })

  /** App info page (Requirements 11.6, 11.7, 12.11). True when App info itself opened. */
  fun openAppInfo(): Boolean = open(SettingsTargets.appInfo) == 0

  /** HyperOS Autostart page (12.2). False → App info (or Settings) opened instead (12.3). */
  fun openAutostart(): Boolean = open(SettingsTargets.autostart) == 0

  /** Battery exclusion request (12.4). False → battery settings opened instead (12.5). */
  fun requestIgnoreBatteryOptimisation(): Boolean =
    open(SettingsTargets.batteryOptimisation) == 0

  /** Airplane mode settings (13.7). True when that exact screen opened. */
  fun openAirplaneSettings(): Boolean = open(SettingsTargets.airplane) == 0

  /** Mobile network settings (13.7). True when the operator screen opened. */
  fun openMobileNetworkSettings(): Boolean = open(SettingsTargets.mobileNetwork) == 0

  /**
   * Exact alarm access page (reminders 11.9). Below API 31 the page does not exist, so App
   * info opens. True when the exact alarm page itself opened.
   */
  fun openExactAlarmSettings(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      open(SettingsTargets.exactAlarm) == 0
    } else {
      open(SettingsTargets.appInfo)
      false
    }
  /** Index of the target that opened, or null when none did. */
  private fun open(chain: List<SettingsTarget>): Int? {
    val context = contextProvider()
    val intents = chain.map { toIntent(it, context) }
    val order = SettingsTargets.candidates(chain) { resolves(context, intents[chain.indexOf(it)]) }
    return order.firstOrNull { start(context, intents[it]) }
  }

  private fun toIntent(target: SettingsTarget, context: Context): Intent {
    val intent = if (target.action != null) Intent(target.action) else Intent()
    target.component?.let { (pkg, cls) -> intent.component = ComponentName(pkg, cls) }
    if (target.withPackageUri) intent.data = Uri.fromParts("package", context.packageName, null)
    return intent
  }

  private fun resolves(context: Context, intent: Intent): Boolean {
    val info = resolve(context.packageManager, intent) ?: return false
    val activity = info.activityInfo ?: return false
    return activity.exported || activity.packageName == context.packageName
  }

  private fun resolve(pm: PackageManager, intent: Intent): ResolveInfo? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      pm.resolveActivity(
        intent,
        PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()),
      )
    } else {
      @Suppress("DEPRECATION")
      pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
    }

  private fun start(context: Context, intent: Intent): Boolean {
    if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      context.startActivity(intent)
      true
    } catch (_: ActivityNotFoundException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }
}
