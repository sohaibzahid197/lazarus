package dev.lazarus.necromancer.gateway

import dev.lazarus.necromancer.log.LogMask
import java.util.PriorityQueue
import java.util.concurrent.atomic.AtomicLong

/** One Inbound_Message as handed to JS by `takeNextInbound()`. */
data class InboundMessage(
  val id: String,
  val seq: Long,
  val sender: String,
  val body: String,
  val receivedAt: Long,
) {
  /** Never prints the body; the sender is masked (Requirement 14.14 style). */
  override fun toString(): String = "InboundMessage(id=$id, seq=$seq, from=${LogMask.tail3(sender)}, receivedAt=$receivedAt)"
}

/**
 * The `pending_inbox` table (Requirement 1.6). The only storage that holds a body.
 * Implementations throw on storage errors.
 */
interface PendingInboxStore {
  /** Largest stored `seq`, or 0 when the table is empty. */
  fun maxSeq(): Long

  fun insert(message: InboundMessage)

  fun loadAll(): List<InboundMessage>

  fun delete(id: String)
}

/**
 * Pure queue logic behind [InboxQueue] (no Android types, JVM-testable).
 *
 * - Memory messages (loop attached) live only in this process (Requirement 14.7).
 * - Pending messages are written to [store] by [persistPending] and enter memory only through
 *   [loadPending], which the service calls on start (Requirement 1.6).
 * - [takeNext] returns the oldest waiting message by `(receivedAt, seq)` (Requirement 1.7, 10.8).
 * - `seq` comes from one [AtomicLong] seeded above the largest stored `seq`, so creation order
 *   survives a restart.
 */
class InboxCore(
  private val store: PendingInboxStore,
  private val newId: () -> String,
  private val log: (String) -> Unit,
) {
  private class Entry(val message: InboundMessage, val persisted: Boolean)

  private val order = compareBy<Entry>({ it.message.receivedAt }, { it.message.seq })
  private val waiting = PriorityQueue(order)
  private val taken = HashMap<String, Entry>()
  private val seq = AtomicLong(0)
  @Volatile private var seeded = false
  @Volatile private var listener: (() -> Unit)? = null

  /** True while the JS loop is attached; the receiver then uses [enqueueMemory]. */
  val isAttached: Boolean
    get() = listener != null

  /** Attaches the JS loop; [onAvailable] fires whenever a message becomes waiting. */
  fun attach(onAvailable: () -> Unit) {
    listener = onAvailable
    if (synchronized(this) { waiting.isNotEmpty() }) onAvailable()
  }

  fun detach() {
    listener = null
  }

  /** Receiver path while the loop is attached: memory only, no storage write. */
  fun enqueueMemory(sender: String, body: String, receivedAt: Long): InboundMessage {
    val message = InboundMessage(newId(), nextSeq(), sender, body, receivedAt)
    synchronized(this) { waiting.add(Entry(message, persisted = false)) }
    listener?.invoke()
    return message
  }

  /** Receiver path while the service is not running (not paused): one `pending_inbox` row. Throws on failure. */
  fun persistPending(sender: String, body: String, receivedAt: Long): InboundMessage {
    val message = InboundMessage(newId(), nextSeq(), sender, body, receivedAt)
    store.insert(message)
    log("InboxQueue: stored pending (from ${LogMask.tail3(sender)})")
    return message
  }

  /**
   * Service start: moves every stored row not already known into the waiting queue.
   * Returns the number added. Throws when the table cannot be read.
   */
  fun loadPending(): Int {
    val rows = store.loadAll()
    seedFrom(rows.maxOfOrNull { it.seq } ?: 0L)
    val added =
      synchronized(this) {
        val known = HashSet<String>(taken.keys).apply { waiting.forEach { add(it.message.id) } }
        rows.filter { it.id !in known }.onEach { waiting.add(Entry(it, persisted = true)) }.size
      }
    if (added > 0) listener?.invoke()
    return added
  }

  /** Oldest waiting message by `(receivedAt, seq)`, or null. It stays held until [complete]. */
  @Synchronized
  fun takeNext(): InboundMessage? {
    val entry = waiting.poll() ?: return null
    taken[entry.message.id] = entry
    return entry.message
  }

  /** Drops the body from memory and deletes the pending row, if any (Requirement 14.7). Throws when the delete fails. */
  fun complete(id: String) {
    val entry = synchronized(this) { taken.remove(id) } ?: return
    if (entry.persisted) store.delete(id)
  }

  @Synchronized
  fun waitingCount(): Int = waiting.size

  private fun nextSeq(): Long {
    if (!seeded) seedFrom(runCatching { store.maxSeq() }.getOrElse { e ->
      log("InboxQueue: seq seed failed (${e.javaClass.simpleName})")
      0L
    })
    return seq.incrementAndGet()
  }

  private fun seedFrom(maxSeq: Long) {
    seq.accumulateAndGet(maxSeq) { cur, floor -> maxOf(cur, floor) }
    seeded = true
  }
}
