package dev.lazarus.necromancer.gateway

/** Per-part Send_Result; `wire` matches the JS `PartResult` strings. */
enum class PartResult(val wire: String) {
  SENT("sent"),
  FAILED_RADIO("failed-radio"),
  FAILED_NO_SERVICE("failed-no-service"),
  FAILED_OTHER("failed-other"),
  ;

  /** Generic radio failure or no-service error: the only failures that allow the retry (Requirement 8.3). */
  val isRetryable: Boolean get() = this == FAILED_RADIO || this == FAILED_NO_SERVICE
}

/** Final report for one `sendParts` call; [toWire] gives the JS `SendReportPayload` fields. */
sealed class SendReport {
  data class Done(val results: List<PartResult>, val attempts: Int) : SendReport()
  object RefusedStopped : SendReport()
  object Cancelled : SendReport()

  val status: String
    get() = when (this) {
      is Done -> "done"
      RefusedStopped -> "refused-stopped"
      Cancelled -> "cancelled"
    }

  val wireResults: List<String> get() = if (this is Done) results.map { it.wire } else emptyList()
  val wireAttempts: Int get() = if (this is Done) attempts else 0
}

/** Sent-status result codes. Literal values of `Activity.RESULT_OK` and `SmsManager.RESULT_ERROR_*`. */
object SendResultCodes {
  const val RESULT_OK = -1
  const val RESULT_ERROR_GENERIC_FAILURE = 1
  const val RESULT_ERROR_RADIO_OFF = 2
  const val RESULT_ERROR_NO_SERVICE = 4

  /** Design mapping for `SendResultReceiver`; every other code is `failed-other`. */
  fun map(resultCode: Int): PartResult = when (resultCode) {
    RESULT_OK -> PartResult.SENT
    RESULT_ERROR_GENERIC_FAILURE -> PartResult.FAILED_RADIO
    RESULT_ERROR_NO_SERVICE, RESULT_ERROR_RADIO_OFF -> PartResult.FAILED_NO_SERVICE
    else -> PartResult.FAILED_OTHER
  }
}

/** Single-threaded scheduler; the returned function cancels the delayed action. */
interface SendScheduler {
  fun postDelayed(delayMs: Long, action: () -> Unit): () -> Unit
}

/** Android side of the tracker. Every method is called on the scheduler thread. */
interface SendPort {
  /** Reads the persisted Stop_List. May throw; a throw counts as stopped (never send). */
  fun isStopped(number: String): Boolean

  /** True when every part fits in one SMS segment. */
  fun partsValid(parts: List<String>): Boolean

  /** Hands one multipart SMS to the radio. Results arrive later through [SendTracker.onPartResult]. May throw. */
  fun send(sendId: String, attempt: Int, number: String, parts: List<String>)
}

/**
 * FIFO send state machine (design `SendTracker`, Requirements 3.8, 3.9, 8.1 to 8.8, 13.2).
 *
 * One multipart SMS at a time, including its retry wait. Before every attempt the Stop_List is
 * read; a hit or a read failure gives `refused-stopped`. Each attempt has one [sendTimeoutMs]
 * timer; parts still without a result then become `failed-no-service`. When the first attempt
 * has a retryable failure and no `failed-other`, the whole list is sent again once,
 * [retryDelayMs] after the last result. The report holds the results of the last attempt.
 *
 * Not thread-safe: call every method on the [scheduler] thread. Pure Kotlin for JVM tests.
 */
class SendTracker(
  private val scheduler: SendScheduler,
  private val port: SendPort,
  private val onSendState: (Boolean) -> Unit,
  private val log: (String) -> Unit,
  private val sendTimeoutMs: Long = SEND_TIMEOUT_MS,
  private val retryDelayMs: Long = RETRY_DELAY_MS,
) {
  private class Item(
    val sendId: String,
    val number: String,
    val parts: List<String>,
    val onComplete: (SendReport) -> Unit,
  ) {
    var attempt = 0
    var results: Array<PartResult?> = arrayOfNulls(parts.size)
    var cancelTimer: (() -> Unit)? = null
    var retryWaiting = false
  }

  private val queue = ArrayDeque<Item>()
  private var active: Item? = null
  private var busy = false

  val isSending: Boolean get() = busy

  /** Queues one multipart SMS; [onComplete] is called exactly once on the scheduler thread. */
  fun enqueue(sendId: String, number: String, parts: List<String>, onComplete: (SendReport) -> Unit) {
    queue.addLast(Item(sendId, number, parts.toList(), onComplete))
    updateBusy()
    pump()
  }

  /** Sent-status result for one part. Stale, duplicate and unknown results are ignored. */
  fun onPartResult(sendId: String, attempt: Int, partIndex: Int, result: PartResult) {
    val item = active ?: return
    if (item.sendId != sendId || item.attempt != attempt || item.retryWaiting) return
    if (partIndex !in item.results.indices || item.results[partIndex] != null) return
    item.results[partIndex] = result
    if (item.results.all { it != null }) finishAttempt(item)
  }

  /**
   * Resolves queued items and an item in its retry wait for [number] as `cancelled`
   * (Requirement 3.9). An attempt already handed to the radio cannot be recalled.
   */
  fun cancel(number: String): Int {
    val removed = queue.filter { it.number == number }
    queue.removeAll { it.number == number }
    var count = removed.size
    val current = active
    if (current != null && current.number == number && current.retryWaiting) {
      current.cancelTimer?.invoke()
      active = null
      count++
      current.onComplete(SendReport.Cancelled)
    }
    removed.forEach { it.onComplete(SendReport.Cancelled) }
    if (count > 0) log("SendTracker: cancelled $count send(s)")
    updateBusy()
    pump()
    return count
  }

  private fun pump() {
    while (active == null) {
      val next = queue.removeFirstOrNull() ?: break
      active = next
      startAttempt(next)
    }
    updateBusy()
  }

  private fun startAttempt(item: Item) {
    item.attempt++
    item.retryWaiting = false
    item.results = arrayOfNulls(item.parts.size)
    if (stoppedOrUnreadable(item.number)) return complete(item, SendReport.RefusedStopped)
    if (item.parts.isEmpty()) return complete(item, SendReport.Done(emptyList(), item.attempt))
    if (!port.partsValid(item.parts)) {
      log("SendTracker: part too long, not sent")
      return complete(item, SendReport.Done(List(item.parts.size) { PartResult.FAILED_OTHER }, item.attempt))
    }
    try {
      port.send(item.sendId, item.attempt, item.number, item.parts)
    } catch (e: RuntimeException) {
      log("SendTracker: send call failed (${e.javaClass.simpleName})")
      return complete(item, SendReport.Done(List(item.parts.size) { PartResult.FAILED_OTHER }, item.attempt))
    }
    val attempt = item.attempt
    item.cancelTimer = scheduler.postDelayed(sendTimeoutMs) { onTimeout(item, attempt) }
  }

  private fun stoppedOrUnreadable(number: String): Boolean =
    try {
      port.isStopped(number)
    } catch (e: RuntimeException) {
      log("SendTracker: stop list unreadable (${e.javaClass.simpleName}), refusing")
      true
    }

  private fun onTimeout(item: Item, attempt: Int) {
    if (active !== item || item.attempt != attempt || item.retryWaiting) return
    item.cancelTimer = null
    for (i in item.results.indices) if (item.results[i] == null) item.results[i] = PartResult.FAILED_NO_SERVICE
    finishAttempt(item)
  }

  private fun finishAttempt(item: Item) {
    item.cancelTimer?.invoke()
    item.cancelTimer = null
    val results = item.results.map { it ?: PartResult.FAILED_NO_SERVICE }
    if (shouldRetry(item.attempt, results)) {
      item.retryWaiting = true
      val attempt = item.attempt
      item.cancelTimer = scheduler.postDelayed(retryDelayMs) { onRetryDue(item, attempt) }
      return
    }
    complete(item, SendReport.Done(results, item.attempt))
  }

  private fun onRetryDue(item: Item, attempt: Int) {
    if (active !== item || item.attempt != attempt || !item.retryWaiting) return
    item.cancelTimer = null
    startAttempt(item)
  }

  private fun complete(item: Item, report: SendReport) {
    item.cancelTimer?.invoke()
    item.cancelTimer = null
    if (active === item) active = null
    item.onComplete(report)
    pump()
  }

  private fun updateBusy() {
    val now = active != null || queue.isNotEmpty()
    if (now == busy) return
    busy = now
    onSendState(now)
  }

  companion object {
    const val SEND_TIMEOUT_MS = 60_000L
    const val RETRY_DELAY_MS = 30_000L
    const val MAX_ATTEMPTS = 2

    /** Retry once on a radio or no-service failure; a `failed-other` part ends the send (Requirement 8.4). */
    fun shouldRetry(attempt: Int, results: List<PartResult>): Boolean =
      attempt < MAX_ATTEMPTS &&
        results.any { it.isRetryable } &&
        results.none { it == PartResult.FAILED_OTHER }
  }
}
