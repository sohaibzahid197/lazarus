package dev.lazarus.necromancer.gateway

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import dev.lazarus.necromancer.MainActivity
import dev.lazarus.necromancer.R

/**
 * Persistent Gateway_Service notification (Requirement 9.2, 9.3, 9.7).
 * Text comes only from [GatewayNotificationText]: a state word and a count, never a number or body.
 */
object GatewayNotification {
  const val CHANNEL_ID = "gateway"
  const val NOTIFICATION_ID = 1001
  private const val CHANNEL_NAME = "Gateway"
  private const val REQ_CONTENT = 1001
  private const val REQ_DELETE = 1002
  private const val TAG = "Lazarus"

  @Volatile private var stateWord: String = GatewayNotificationText.FALLBACK_WORD
  @Volatile private var repliedToday: Int = 0

  /** Low-importance channel; safe to call repeatedly (minSdk 26, channels always exist). */
  fun ensureChannel(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
      description = "Shows that the SMS gateway is running"
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  /** Remembers the latest values; [current] uses them for every (re)post. */
  fun setState(rawStateWord: String, replied: Int) {
    stateWord = GatewayNotificationText.stateWord(rawStateWord)
    repliedToday = if (replied < 0) 0 else replied
  }

  fun current(context: Context): Notification = build(context, stateWord, repliedToday)

  fun build(context: Context, rawStateWord: String, replied: Int): Notification {
    ensureChannel(context)
    return NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_lazarus)
      .setContentTitle(GatewayNotificationText.TITLE)
      .setContentText(GatewayNotificationText.text(rawStateWord, replied))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(contentIntent(context))
      .setDeleteIntent(deleteIntent(context))
      .build()
  }

  /**
   * Re-posts with the same id, which keeps it attached to the foreground service.
   * Returns false when notifications are blocked (Requirement 9.7: the service keeps running).
   */
  fun post(context: Context): Boolean {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return false
    return try {
      manager.notify(NOTIFICATION_ID, current(context))
      true
    } catch (e: SecurityException) {
      Log.w(TAG, "GatewayNotification: post refused (${e.javaClass.simpleName})")
      false
    }
  }

  fun cancel(context: Context) {
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
  }

  /** Tap opens the Main_Screen; the service is untouched (Requirement 9.3). */
  private fun contentIntent(context: Context): PendingIntent {
    val intent = Intent(context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context, REQ_CONTENT, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  /** Dismissal goes to [RestartReceiver], which re-posts at once while the service runs. */
  private fun deleteIntent(context: Context): PendingIntent {
    val intent = Intent(context, RestartReceiver::class.java).setAction(RestartReceiver.ACTION_REPOST)
    return PendingIntent.getBroadcast(
      context, REQ_DELETE, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }
}
