package dev.lazarus.necromancer.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class InboxCoreTest {
  private class MapStore : PendingInboxStore {
    val rows = LinkedHashMap<String, InboundMessage>()
    override fun maxSeq(): Long = rows.values.maxOfOrNull { it.seq } ?: 0L
    override fun insert(message: InboundMessage) { rows[message.id] = message }
    override fun loadAll(): List<InboundMessage> = rows.values.toList()
    override fun delete(id: String) { rows.remove(id) }
  }

  private var nextId = 0
  private val logs = ArrayList<String>()
  private fun core(store: PendingInboxStore) = InboxCore(store, { "m${nextId++}" }, { logs.add(it) })

  @Test
  fun takesByReceiveTimeThenCreationOrder() {
    val q = core(MapStore())
    q.enqueueMemory("+923001111111", "b", 200)
    q.enqueueMemory("+923002222222", "a", 100)
    q.enqueueMemory("+923003333333", "c", 100)
    assertEquals(listOf("a", "c", "b"), generateSequence { q.takeNext() }.map { it.body }.toList())
  }

  @Test
  fun pendingRowsLoadOnceAndCompleteDeletesRow() {
    val store = MapStore()
    val q = core(store)
    val m = q.persistPending("+923001234567", "Urdu سوال", 50)
    assertNull(q.takeNext())
    assertEquals(1, q.loadPending())
    assertEquals(0, q.loadPending())
    assertEquals(m, q.takeNext())
    assertEquals(0, q.loadPending())
    q.complete(m.id)
    assertTrue(store.rows.isEmpty())
  }

  @Test
  fun seqContinuesAbovePersistedMaxAfterRestart() {
    val store = MapStore()
    store.insert(InboundMessage("old", 41, "+923001234567", "x", 100))
    val q = core(store)
    val fresh = q.enqueueMemory("+923007654321", "y", 100)
    assertEquals(42, fresh.seq)
    q.loadPending()
    assertEquals(listOf("old", fresh.id), generateSequence { q.takeNext() }.map { it.id }.toList())
  }

  @Test
  fun logsNeverContainBodyOrFullNumber() {
    val q = core(MapStore())
    q.persistPending("+923001234567", "secret body", 1)
    assertEquals(listOf("InboxQueue: stored pending (from ••••••••••567)"), logs)
  }

  @Test
  fun attachSignalsWaitingMessages() {
    val q = core(MapStore())
    var calls = 0
    q.enqueueMemory("+923001234567", "x", 1)
    q.attach { calls++ }
    q.enqueueMemory("+923001234567", "y", 2)
    assertEquals(2, calls)
    assertTrue(q.isAttached)
  }
}
