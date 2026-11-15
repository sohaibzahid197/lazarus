package dev.lazarus.necromancer.log

/**
 * The only Kotlin masking helper (Requirement 17.7 exception). Used only in logcat lines:
 * decode failure (1.9), paused drop (9.14) and Pending_Stop_Record (14.14).
 *
 * Same rule as brain `maskSender`: keep the last 3 UTF-16 code units, replace every
 * other code unit with `•`; an empty string becomes a single `•`.
 * Pure Kotlin, no Android dependencies.
 */
object LogMask {
    private const val KEPT_TAIL = 3
    private const val MASK_CHAR = "•"

    fun tail3(s: String): String {
        if (s.isEmpty()) return MASK_CHAR
        if (s.length <= KEPT_TAIL) return s
        val hidden = s.length - KEPT_TAIL
        return MASK_CHAR.repeat(hidden) + s.substring(hidden)
    }
}
