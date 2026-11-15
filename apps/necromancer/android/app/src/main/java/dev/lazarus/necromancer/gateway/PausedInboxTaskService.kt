package dev.lazarus.necromancer.gateway

import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import dev.lazarus.necromancer.log.LogMask

/**
 * Paused path (Requirement 9.10, 9.12): runs one short Headless JS task `LazarusPausedInbox`
 * per Inbound_Message while the gateway is paused. The body travels only in the start Intent's
 * extras (memory) and is never written or logged. Returns `START_NOT_STICKY` so Android never
 * redelivers the Intent.
 */
class PausedInboxTaskService : HeadlessJsTaskService() {

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // The base class returns START_REDELIVER_INTENT when a task starts; the body must not
    // outlive this process, so the Intent is never redelivered.
    super.onStartCommand(intent, flags, startId)
    return START_NOT_STICKY
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val message = readExtras(intent)
    if (message == null) {
      Log.w(TAG, "PausedInbox: ignored start without a complete message")
      return null
    }
    val args = Arguments.createMap().apply {
      putString(ARG_SENDER, message.sender)
      putString(ARG_BODY, message.body)
      putDouble(ARG_RECEIVED_AT, message.receivedAt.toDouble())
    }
    return HeadlessJsTaskConfig(TASK_KEY, args, TIMEOUT_MS, true)
  }

  /** One paused message as carried in the start Intent. */
  data class PausedMessage(val sender: String, val body: String, val receivedAt: Long) {
    override fun toString(): String = "PausedMessage(from ${LogMask.tail3(sender)}, receivedAt=$receivedAt)"
  }

  companion object {
    const val TASK_KEY = "LazarusPausedInbox"
    const val TIMEOUT_MS = 15_000L
    private const val TAG = "Lazarus"

    const val EXTRA_SENDER = "dev.lazarus.necromancer.extra.SENDER"
    const val EXTRA_BODY = "dev.lazarus.necromancer.extra.BODY"
    const val EXTRA_RECEIVED_AT = "dev.lazarus.necromancer.extra.RECEIVED_AT"

    private const val ARG_SENDER = "sender"
    private const val ARG_BODY = "body"
    private const val ARG_RECEIVED_AT = "receivedAt"

    /**
     * Starts one paused task for one message. Exceptions from `startService`
     * (`IllegalStateException`, including `BackgroundServiceStartNotAllowedException`, and
     * `SecurityException`) propagate so `SmsReceiver` can fall back to `StopKeywordCheck`.
     * The wake lock is taken only after the start succeeds.
     */
    @JvmStatic
    fun start(context: Context, sender: String, body: String, receivedAt: Long) {
      val intent = Intent(context, PausedInboxTaskService::class.java)
        .putExtra(EXTRA_SENDER, sender)
        .putExtra(EXTRA_BODY, body)
        .putExtra(EXTRA_RECEIVED_AT, receivedAt)
      context.startService(intent)
      acquireWakeLockNow(context)
    }

    /** Reads a complete message from the Intent extras, or null if any field is missing. */
    @JvmStatic
    fun readExtras(intent: Intent?): PausedMessage? {
      if (intent == null) return null
      val sender = intent.getStringExtra(EXTRA_SENDER)
      val body = intent.getStringExtra(EXTRA_BODY)
      val receivedAt = intent.getLongExtra(EXTRA_RECEIVED_AT, -1L)
      if (sender.isNullOrEmpty() || body == null || receivedAt < 0L) return null
      return PausedMessage(sender, body, receivedAt)
    }
  }
}
