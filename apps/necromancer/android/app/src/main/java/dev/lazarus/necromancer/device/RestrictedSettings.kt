package dev.lazarus.necromancer.device

import android.app.AppOpsManager
import android.content.Context
import android.os.Build
import android.os.Process

/**
 * Detects Android 13+ Restricted_Settings blocking the SMS permissions (Requirement 11.7).
 * There is no public API: the app-op `android:access_restricted_settings` is read with
 * `unsafeCheckOpNoThrow` inside `try/catch`. Any failure reports "not blocked", and the
 * JS fallback heuristic (instant denial with no rationale) covers that case.
 */
class RestrictedSettings(private val context: Context) {

  fun isBlocked(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
    return try {
      val appOps = context.getSystemService(AppOpsManager::class.java) ?: return false
      val mode = appOps.unsafeCheckOpNoThrow(OP_ACCESS_RESTRICTED_SETTINGS, Process.myUid(), context.packageName)
      isBlockedMode(mode)
    } catch (_: Exception) {
      false
    }
  }

  companion object {
    const val OP_ACCESS_RESTRICTED_SETTINGS = "android:access_restricted_settings"

    /** `MODE_ERRORED` or `MODE_IGNORED` → blocked; allowed and default are not. */
    fun isBlockedMode(mode: Int): Boolean =
      mode == AppOpsManager.MODE_ERRORED || mode == AppOpsManager.MODE_IGNORED
  }
}
