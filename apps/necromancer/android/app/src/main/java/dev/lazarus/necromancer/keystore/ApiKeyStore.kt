package dev.lazarus.necromancer.keystore

/**
 * Stores the Operator's Gemini API key (Requirement 16).
 * Implementations must never log the key or put it in an exception message.
 * Calls block on disk and Keystore work, so call them off the JS and main threads.
 */
interface ApiKeyStore {
  fun read(): KeyRead

  /** Replaces any stored key, including unreadable data (Requirement 16.6, 16.21). */
  fun write(key: String)

  /** After this returns, [read] reports [KeyRead.Absent]. */
  fun delete()
}

/** Result of [ApiKeyStore.read]. `toString` never reveals the key. */
sealed class KeyRead {
  abstract val status: String

  class Present(val key: String) : KeyRead() {
    override val status: String = "present"
    override fun toString(): String = "KeyRead.Present(<hidden>)"
  }

  object Absent : KeyRead() {
    override val status: String = "absent"
    override fun toString(): String = "KeyRead.Absent"
  }

  /** The store could not be opened, the Keystore alias is missing, or decryption failed (16.20). */
  object Unreadable : KeyRead() {
    override val status: String = "unreadable"
    override fun toString(): String = "KeyRead.Unreadable"
  }
}
