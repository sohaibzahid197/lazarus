package dev.lazarus.necromancer.gateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Not exported. Receives the explicit sent-status PendingIntents of [SmsSender] and forwards
 * the mapped Send_Result to [SendQueue]. Results for an unknown or older attempt are ignored there.
 */
class SendResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_SENT) return
    val sendId = intent.getStringExtra(EXTRA_SEND_ID) ?: return
    val attempt = intent.getIntExtra(EXTRA_ATTEMPT, -1)
    val part = intent.getIntExtra(EXTRA_PART, -1)
    if (attempt < 1 || part < 0) return
    SendQueue.get(context).onPartResult(sendId, attempt, part, SendResultCodes.map(resultCode))
  }

  companion object {
    const val ACTION_SENT = "dev.lazarus.necromancer.SMS_SENT"
    const val EXTRA_SEND_ID = "sendId"
    const val EXTRA_ATTEMPT = "attempt"
    const val EXTRA_PART = "part"
  }
}
