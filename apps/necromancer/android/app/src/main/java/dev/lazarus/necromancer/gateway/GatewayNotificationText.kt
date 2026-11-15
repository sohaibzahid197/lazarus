package dev.lazarus.necromancer.gateway

/**
 * Pure text builder for the persistent notification (Requirement 9.2).
 * The only inputs are a Heartbeat state word from a fixed set and a count, so the text
 * can never carry a Sender_Address, a number or a message body.
 */
object GatewayNotificationText {
  const val TITLE = "Lazarus"

  /** Heartbeat_State words (design `Heartbeat.state`). */
  val STATE_WORDS: Set<String> = setOf("ALIVE", "SENDING", "SLEEPING")

  /** Used when the caller passes anything outside [STATE_WORDS]. */
  const val FALLBACK_WORD = "ALIVE"

  fun stateWord(raw: String): String {
    val word = raw.trim().uppercase()
    return if (word in STATE_WORDS) word else FALLBACK_WORD
  }

  fun text(rawStateWord: String, repliedToday: Int): String {
    val count = if (repliedToday < 0) 0 else repliedToday
    val noun = if (count == 1) "reply" else "replies"
    return "Lazarus is ${stateWord(rawStateWord)} · $count $noun today"
  }
}
