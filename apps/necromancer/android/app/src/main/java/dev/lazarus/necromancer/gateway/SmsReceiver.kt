package dev.lazarus.necromancer.gateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import dev.lazarus.necromancer.log.LogMask
import dev.lazarus.necromancer.stop.PendingStopStore
import dev.lazarus.necromancer.stop.StopKeywordCheck
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Manifest receiver for `SMS_RECEIVED` (exported, guarded by `BROADCAST_SMS`).
 *
 * Builds one Inbound_Message per Sender_Address (Requirement 1.1–1.3, 1.8) and hands it on by
 * [ReceiveBranch] (Requirement 1.4–1.6, 9.12–9.14). Storage work runs on one background thread
 * under [goAsync], so deliveries keep their order and `onReceive` returns at once.
 *
 * The app is not the default SMS app and holds no `READ_SMS`/`WRITE_SMS`, so the SMS inbox is
 * never read, edited or deleted (Requirement 1.10). Bodies are never logged.
 */
class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val receivedAt = System.currentTimeMillis()
    val grouping = decode(intent)
    grouping.failureLines.forEach { Log.w(TAG, it) }
    if (grouping.messages.isEmpty()) return
    val app = context.applicationContext
    val pending = goAsync()
    worker.execute {
      try {
        grouping.messages.forEach { handOff(app, it, receivedAt) }
      } catch (e: RuntimeException) {
        Log.w(TAG, "SmsReceiver: hand-off failed (${e.javaClass.simpleName})")
      } finally {
        pending.finish()
      }
    }
  }

  private fun decode(intent: Intent): PduGrouping =
    try {
      val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        .orEmpty()
        .map { sms -> PduPart(sms?.originatingAddress, sms?.messageBody) }
      SmsReceiveLogic.group(parts)
    } catch (e: RuntimeException) {
      PduGrouping(emptyList(), listOf(SmsReceiveLogic.decodeFailureLine(e.javaClass.simpleName, null)))
    }

  private fun handOff(context: Context, sms: ReceivedSms, receivedAt: Long) {
    val inbox = InboxQueue.get(context)
    val paused = GatewayService.readPausedOrNull(context)
    when (SmsReceiveLogic.branch(paused, GatewayService.isRunning, inbox.isAttached)) {
      ReceiveBranch.PAUSED_TASK -> startPausedTask(context, sms, receivedAt)
      ReceiveBranch.MEMORY_QUEUE -> inbox.enqueueMemory(sms.sender, sms.body, receivedAt)
      ReceiveBranch.PENDING_INBOX -> storePendingAndStart(context, inbox, sms, receivedAt)
    }
  }

  private fun startPausedTask(context: Context, sms: ReceivedSms, receivedAt: Long) {
    try {
      PausedInboxTaskService.start(context, sms.sender, sms.body, receivedAt)
    } catch (e: RuntimeException) {
      // IllegalStateException (incl. BackgroundServiceStartNotAllowedException) or SecurityException.
      SmsReceiveLogic.handleRefusedPausedTask(
        sender = sms.sender,
        body = sms.body,
        receivedAt = receivedAt,
        matchesStop = StopKeywordCheck.fromAssets(context)::matches,
        insertStop = PendingStopStore.fromContext(context)::insert,
        log = { Log.w(TAG, it) },
      )
    }
  }

  private fun storePendingAndStart(context: Context, inbox: InboxCore, sms: ReceivedSms, receivedAt: Long) {
    try {
      inbox.persistPending(sms.sender, sms.body, receivedAt)
      // The service may be running with its loop still starting, after its own pending load.
      if (GatewayService.isRunning) inbox.loadPending()
    } catch (e: RuntimeException) {
      // Storage failed: keep the message in memory so this process can still answer it.
      Log.w(TAG, "SmsReceiver: pending store failed (${e.javaClass.simpleName}, from ${LogMask.tail3(sms.sender)})")
      inbox.enqueueMemory(sms.sender, sms.body, receivedAt)
    }
    GatewayService.start(context)
  }

  companion object {
    private const val TAG = "Lazarus"

    /** One thread keeps deliveries in arrival order. */
    private val worker: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "lazarus-sms-receive") }
  }
}
