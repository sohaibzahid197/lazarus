package dev.lazarus.necromancer.gateway

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import dev.lazarus.necromancer.MainActivity
import dev.lazarus.necromancer.R

/**
 * Not exported; reached only through the explicit alarm PendingIntent set by [BootReceiver].
 * 60 s after boot or package replacement, if the Gateway_Service is still not running and the
 * Operator has not paused it, posts exactly 1 notification (fixed id, so a repeat replaces it)
 * telling the Operator to open Necromancer (Requirement 10.5, 9.9). Writes no Gateway_State.
 */
class WatchdogReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_WATCHDOG) return
    val app = context.applicationContext
    val pending = goAsync()
    Thread {
      try {
        check(app)
      } finally {
        pending.finish()
      }
    }.start()
  }

  private fun check(context: Context) {
    val paused = GatewayService.readPausedOrNull(context)
    if (BootDecision.watchdog(GatewayService.isRunning, paused) != BootDecision.Watchdog.NOTIFY) return
    post(context)
  }

  private fun post(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) {
      Log.w(TAG, "WatchdogReceiver: notifications blocked")
      return
    }
    GatewayNotification.ensureChannel(context)
    val notification = NotificationCompat.Builder(context, GatewayNotification.CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_lazarus)
      .setContentTitle(TITLE)
      .setContentText(TEXT)
      .setStyle(NotificationCompat.BigTextStyle().bigText(TEXT))
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(contentIntent(context))
      .build()
    try {
      manager.notify(NOTIFICATION_ID, notification)
    } catch (e: SecurityException) {
      Log.w(TAG, "WatchdogReceiver: post refused (${e.javaClass.simpleName})")
    }
  }

  private fun contentIntent(context: Context): PendingIntent {
    val intent = Intent(context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context, REQ_CONTENT, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  companion object {
    const val ACTION_WATCHDOG = "dev.lazarus.necromancer.gateway.WATCHDOG"
    /** Distinct from [GatewayNotification.NOTIFICATION_ID] (1001). */
    const val NOTIFICATION_ID = 1003
    const val TITLE = "Lazarus gateway is not running"
    const val TEXT = "Open Necromancer and check the Setup screen."
    private const val REQ_CONTENT = 1003
    private const val REQ_WATCHDOG = 2002
    private const val TAG = "Lazarus"

    /** Explicit, immutable alarm target; one request code so re-arming replaces the alarm. */
    fun pendingIntent(context: Context): PendingIntent {
      val intent = Intent(context, WatchdogReceiver::class.java).setAction(ACTION_WATCHDOG)
      return PendingIntent.getBroadcast(
        context, REQ_WATCHDOG, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    }
  }
}
