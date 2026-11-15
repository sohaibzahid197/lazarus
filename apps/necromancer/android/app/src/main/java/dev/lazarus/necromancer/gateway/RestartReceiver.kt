package dev.lazarus.necromancer.gateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Not exported; reached only through explicit PendingIntents.
 * - [ACTION_RESTART]: restart alarm after Android stopped the service (Requirement 9.4).
 * - [ACTION_REPOST]: the Operator dismissed the notification (Requirement 9.2).
 */
class RestartReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_REPOST -> if (GatewayService.isRunning) GatewayNotification.post(context)
      ACTION_RESTART -> restart(context)
    }
  }

  private fun restart(context: Context) {
    val paused = GatewayService.readPausedOrNull(context)
    if (!GatewayLifecycle.shouldRunOnStart(paused)) return
    if (GatewayService.isRunning) return
    if (!GatewayService.start(context)) Log.w(TAG, "RestartReceiver: restart refused")
  }

  companion object {
    const val ACTION_RESTART = "dev.lazarus.necromancer.gateway.RESTART"
    const val ACTION_REPOST = "dev.lazarus.necromancer.gateway.REPOST"
    private const val TAG = "Lazarus"
  }
}
