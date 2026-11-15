package dev.lazarus.necromancer.gateway

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SmsMessage
import java.util.concurrent.atomic.AtomicInteger

/**
 * Thin wrapper over the default SIM's [SmsManager] (Requirement 8.1, 8.6). No logging here:
 * nothing in this class may print a body or a number.
 */
class SmsSender(private val context: Context) {
  /** Each part must fit in exactly one SMS segment (design `SendQueue`). */
  fun partsValid(parts: List<String>): Boolean =
    parts.all { SmsMessage.calculateLength(it, false)[0] == 1 }

  /** One multipart SMS, each part one segment, list order kept, text unchanged. Throws on API refusal. */
  fun send(sendId: String, attempt: Int, number: String, parts: List<String>) {
    val sentIntents = ArrayList<PendingIntent>(parts.size)
    parts.indices.forEach { sentIntents.add(sentIntent(sendId, attempt, it)) }
    smsManager().sendMultipartTextMessage(number, null, ArrayList(parts), sentIntents, null)
  }

  private fun smsManager(): SmsManager =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val manager = context.getSystemService(SmsManager::class.java)
        ?: throw IllegalStateException("SmsManager unavailable")
      manager.createForSubscriptionId(SmsManager.getDefaultSmsSubscriptionId())
    } else {
      @Suppress("DEPRECATION")
      SmsManager.getDefault()
    }

  private fun sentIntent(sendId: String, attempt: Int, part: Int): PendingIntent {
    val intent = Intent(context, SendResultReceiver::class.java)
      .setAction(SendResultReceiver.ACTION_SENT)
      .setPackage(context.packageName)
      .putExtra(SendResultReceiver.EXTRA_SEND_ID, sendId)
      .putExtra(SendResultReceiver.EXTRA_ATTEMPT, attempt)
      .putExtra(SendResultReceiver.EXTRA_PART, part)
    return PendingIntent.getBroadcast(
      context, nextRequestCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT,
    )
  }

  private companion object {
    private const val REQUEST_CODE_BASE = 100_000
    private val requestCodes = AtomicInteger(0)

    /** Unique, positive and clear of the fixed request codes (e.g. 2001) used elsewhere. */
    fun nextRequestCode(): Int = REQUEST_CODE_BASE + (requestCodes.getAndIncrement() and 0x3FFFFFFF) % 1_000_000_000
  }
}
