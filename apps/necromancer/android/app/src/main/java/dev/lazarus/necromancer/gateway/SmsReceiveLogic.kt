package dev.lazarus.necromancer.gateway

import dev.lazarus.necromancer.log.LogMask

/** One decoded PDU as Android reports it; either field is null when Android could not read it. */
data class PduPart(val address: String?, val body: String?) {
  override fun toString(): String = "PduPart(from=${address?.let(LogMask::tail3)})"
}

/** One complete SMS from one Sender_Address in one delivery (Requirement 1.1–1.3). */
data class ReceivedSms(val sender: String, val body: String) {
  override fun toString(): String = "ReceivedSms(from=${LogMask.tail3(sender)})"
}

/** Grouping output: complete messages in first-PDU order, plus one log line per discarded SMS. */
data class PduGrouping(val messages: List<ReceivedSms>, val failureLines: List<String>)

/** Where the receiver hands an Inbound_Message (design `SmsReceiver`). */
enum class ReceiveBranch {
  /** Paused by the Operator: one Paused_Path_Task (Requirement 9.12). */
  PAUSED_TASK,

  /** Service running with the JS loop attached: memory queue only (Requirement 1.4, 1.5). */
  MEMORY_QUEUE,

  /** Not running (or loop not yet attached): `pending_inbox` row and service start (Requirement 1.6). */
  PENDING_INBOX,
}

/**
 * Pure receive helpers for `SmsReceiver`. No Android types, so JVM tests cover them.
 * No line built here contains a body or more than the last 3 characters of a sender.
 */
object SmsReceiveLogic {
  const val MISSING_ADDRESS = "missing address"
  const val MISSING_BODY = "missing body"

  /**
   * Groups PDUs by address, keeping PDU order inside each group and the order in which each
   * address first appears. Bodies are joined with nothing added (Requirement 1.2, 1.3).
   * PDUs without an address form one discarded SMS; an address group with any unreadable body
   * is discarded whole, since joining around a gap would change the text (Requirement 1.9).
   */
  fun group(parts: List<PduPart>): PduGrouping {
    val bodies = LinkedHashMap<String, StringBuilder>()
    val broken = LinkedHashSet<String>()
    var missingAddress = false
    for (part in parts) {
      val address = part.address
      if (address == null) {
        missingAddress = true
        continue
      }
      val builder = bodies.getOrPut(address) { StringBuilder() }
      if (part.body == null) broken.add(address) else builder.append(part.body)
    }
    val messages = bodies.filterKeys { it !in broken }.map { (sender, body) -> ReceivedSms(sender, body.toString()) }
    val failures = ArrayList<String>()
    if (missingAddress) failures.add(decodeFailureLine(MISSING_ADDRESS, null))
    broken.forEach { failures.add(decodeFailureLine(MISSING_BODY, it)) }
    return PduGrouping(messages, failures)
  }

  /** One decode-failure line (Requirement 1.9): reason plus, when known, only `LogMask.tail3` of the address. */
  fun decodeFailureLine(reason: String, address: String?): String =
    if (address == null) "SmsReceiver: decode failed ($reason)"
    else "SmsReceiver: decode failed ($reason, from ${LogMask.tail3(address)})"

  /** The paused-drop line of Requirement 9.14. */
  fun droppedWhilePausedLine(sender: String): String =
    "SmsReceiver: dropped while paused (from ${LogMask.tail3(sender)})"

  /**
   * Branch for one message. An unreadable paused flag (`null`) counts as not paused, matching
   * [GatewayLifecycle.shouldRunOnStart]: the message is queued, and the service reads the flag
   * again before it processes anything.
   */
  fun branch(paused: Boolean?, running: Boolean, attached: Boolean): ReceiveBranch =
    when {
      paused == true -> ReceiveBranch.PAUSED_TASK
      running && attached -> ReceiveBranch.MEMORY_QUEUE
      else -> ReceiveBranch.PENDING_INBOX
    }

  /**
   * Android refused the Paused_Path_Task (Requirement 9.13, 9.14). A body that passes the
   * Stop_Keyword_Check becomes one Pending_Stop_Record through [insertStop] (which writes its own
   * single masked line); any other body is dropped with one masked line. The body is never
   * stored or logged. Returns true when a Pending_Stop_Record was written.
   */
  fun handleRefusedPausedTask(
    sender: String,
    body: String,
    receivedAt: Long,
    matchesStop: (String) -> Boolean,
    insertStop: (sender: String, receivedAt: Long) -> Boolean,
    log: (String) -> Unit,
  ): Boolean {
    if (matchesStop(body)) return insertStop(sender, receivedAt)
    log(droppedWhilePausedLine(sender))
    return false
  }
}
