package dev.lazarus.necromancer.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SendTrackerTest {
  /** Virtual clock: [advance] runs due actions in due-time order, then posting order. */
  private class FakeScheduler : SendScheduler {
    private class Task(val due: Long, val seq: Long, val action: () -> Unit) {
      var cancelled = false
    }

    var now = 0L
      private set
    private var seq = 0L
    private val tasks = ArrayList<Task>()

    override fun postDelayed(delayMs: Long, action: () -> Unit): () -> Unit {
      val task = Task(now + delayMs, seq++, action)
      tasks.add(task)
      return { task.cancelled = true }
    }

    fun pending(): Int = tasks.count { !it.cancelled }

    fun advance(ms: Long) {
      val end = now + ms
      while (true) {
        val next = tasks.filter { !it.cancelled && it.due <= end }
          .minWithOrNull(compareBy<Task>({ it.due }, { it.seq })) ?: break
        tasks.remove(next)
        now = next.due
        next.action()
      }
      tasks.removeAll { it.cancelled }
      now = end
    }
  }

  private data class Sent(val sendId: String, val attempt: Int, val number: String, val parts: List<String>, val at: Long)

  private class FakePort(private val clock: FakeScheduler) : SendPort {
    val sends = ArrayList<Sent>()
    var stopped: (String) -> Boolean = { false }
    var valid = true
    val stopChecks = ArrayList<Long>()

    override fun isStopped(number: String): Boolean {
      stopChecks.add(clock.now)
      return stopped(number)
    }

    override fun partsValid(parts: List<String>): Boolean = valid

    override fun send(sendId: String, attempt: Int, number: String, parts: List<String>) {
      sends.add(Sent(sendId, attempt, number, parts, clock.now))
    }
  }

  private val clock = FakeScheduler()
  private val port = FakePort(clock)
  private val states = ArrayList<Boolean>()
  private val logs = ArrayList<String>()
  private val reports = LinkedHashMap<String, SendReport>()
  private val tracker = SendTracker(clock, port, { states.add(it) }, { logs.add(it) })

  private val a = "+923001111111"
  private val b = "+923002222222"

  private fun enqueue(id: String, number: String = a, parts: List<String> = listOf("p1", "p2")) =
    tracker.enqueue(id, number, parts) {
      assertFalse("onComplete called twice for $id", reports.containsKey(id))
      reports[id] = it
    }

  private fun results(id: String, attempt: Int, vararg r: PartResult) =
    r.forEachIndexed { i, res -> tracker.onPartResult(id, attempt, i, res) }

  private fun done(vararg r: PartResult, attempts: Int) = SendReport.Done(r.toList(), attempts)

  // --- Result-code mapping ---

  @Test
  fun mapsResultCodes() {
    assertEquals(PartResult.SENT, SendResultCodes.map(-1))
    assertEquals(PartResult.FAILED_RADIO, SendResultCodes.map(1))
    assertEquals(PartResult.FAILED_NO_SERVICE, SendResultCodes.map(2))
    assertEquals(PartResult.FAILED_NO_SERVICE, SendResultCodes.map(4))
    listOf(0, 3, 5, 6, 7, 100, Int.MIN_VALUE).forEach {
      assertEquals(PartResult.FAILED_OTHER, SendResultCodes.map(it))
    }
  }

  @Test
  fun shouldRetryRules() {
    assertTrue(SendTracker.shouldRetry(1, listOf(PartResult.SENT, PartResult.FAILED_RADIO)))
    assertTrue(SendTracker.shouldRetry(1, listOf(PartResult.FAILED_NO_SERVICE)))
    assertFalse(SendTracker.shouldRetry(2, listOf(PartResult.FAILED_RADIO)))
    assertFalse(SendTracker.shouldRetry(1, listOf(PartResult.FAILED_RADIO, PartResult.FAILED_OTHER)))
    assertFalse(SendTracker.shouldRetry(1, listOf(PartResult.SENT, PartResult.SENT)))
  }

  @Test
  fun wireFields() {
    val d = done(PartResult.SENT, PartResult.FAILED_RADIO, attempts = 2)
    assertEquals("done", d.status)
    assertEquals(listOf("sent", "failed-radio"), d.wireResults)
    assertEquals(2, d.wireAttempts)
    assertEquals("refused-stopped", SendReport.RefusedStopped.status)
    assertEquals(emptyList<String>(), SendReport.RefusedStopped.wireResults)
    assertEquals("cancelled", SendReport.Cancelled.status)
    assertEquals(0, SendReport.Cancelled.wireAttempts)
  }

  // --- Happy path and state ---

  @Test
  fun allSentCompletesAfterOneAttempt() {
    enqueue("s1", parts = listOf("x", "y", "z"))
    assertEquals(listOf(Sent("s1", 1, a, listOf("x", "y", "z"), 0)), port.sends)
    assertTrue(tracker.isSending)
    results("s1", 1, PartResult.SENT, PartResult.SENT, PartResult.SENT)
    assertEquals(done(PartResult.SENT, PartResult.SENT, PartResult.SENT, attempts = 1), reports["s1"])
    assertFalse(tracker.isSending)
    assertEquals(listOf(true, false), states)
    assertEquals(0, clock.pending())
  }

  @Test
  fun duplicateAndOutOfRangeResultsIgnored() {
    enqueue("s1")
    tracker.onPartResult("s1", 1, 0, PartResult.SENT)
    tracker.onPartResult("s1", 1, 0, PartResult.FAILED_OTHER)
    tracker.onPartResult("s1", 1, 5, PartResult.FAILED_OTHER)
    tracker.onPartResult("other", 1, 1, PartResult.FAILED_OTHER)
    assertTrue(reports.isEmpty())
    tracker.onPartResult("s1", 1, 1, PartResult.SENT)
    assertEquals(done(PartResult.SENT, PartResult.SENT, attempts = 1), reports["s1"])
  }

  // --- Timeout (8.8) ---

  @Test
  fun timeoutAt60sMarksMissingPartsNoService() {
    enqueue("s1")
    tracker.onPartResult("s1", 1, 0, PartResult.SENT)
    clock.advance(59_999)
    assertEquals(1, port.sends.size)
    clock.advance(1)
    // Part 1 timed out → failed-no-service → retry scheduled 30 s later.
    assertTrue(reports.isEmpty())
    clock.advance(29_999)
    assertEquals(1, port.sends.size)
    clock.advance(1)
    assertEquals(2, port.sends.size)
    assertEquals(Sent("s1", 2, a, listOf("p1", "p2"), 90_000), port.sends[1])
  }

  @Test
  fun timeoutOnRetryEndsWithNoServiceAndNoThirdAttempt() {
    enqueue("s1")
    clock.advance(60_000)
    clock.advance(30_000)
    assertEquals(2, port.sends.size)
    clock.advance(60_000)
    assertEquals(done(PartResult.FAILED_NO_SERVICE, PartResult.FAILED_NO_SERVICE, attempts = 2), reports["s1"])
    clock.advance(1_000_000)
    assertEquals(2, port.sends.size)
    assertEquals(listOf(true, false), states)
  }

  // --- Retry (8.2, 8.3) ---

  @Test
  fun retryOnceAt30sAfterLastResult() {
    enqueue("s1")
    tracker.onPartResult("s1", 1, 0, PartResult.FAILED_RADIO)
    clock.advance(10_000)
    tracker.onPartResult("s1", 1, 1, PartResult.SENT) // last result at t=10 s
    clock.advance(29_999)
    assertEquals(1, port.sends.size)
    clock.advance(1)
    assertEquals(Sent("s1", 2, a, listOf("p1", "p2"), 40_000), port.sends[1])
    results("s1", 2, PartResult.SENT, PartResult.SENT)
    assertEquals(done(PartResult.SENT, PartResult.SENT, attempts = 2), reports["s1"])
    assertTrue(tracker.isSending.not())
  }

  @Test
  fun noSecondRetry() {
    enqueue("s1")
    results("s1", 1, PartResult.FAILED_RADIO, PartResult.SENT)
    clock.advance(30_000)
    results("s1", 2, PartResult.FAILED_NO_SERVICE, PartResult.SENT)
    assertEquals(done(PartResult.FAILED_NO_SERVICE, PartResult.SENT, attempts = 2), reports["s1"])
    clock.advance(1_000_000)
    assertEquals(2, port.sends.size)
    assertEquals(0, clock.pending())
  }

  @Test
  fun failedOtherNeverRetries() {
    enqueue("s1")
    results("s1", 1, PartResult.FAILED_RADIO, PartResult.FAILED_OTHER)
    assertEquals(done(PartResult.FAILED_RADIO, PartResult.FAILED_OTHER, attempts = 1), reports["s1"])
    clock.advance(1_000_000)
    assertEquals(1, port.sends.size)
  }

  @Test
  fun resultsDuringRetryWaitIgnored() {
    enqueue("s1")
    clock.advance(60_000) // timeout
    tracker.onPartResult("s1", 1, 0, PartResult.SENT) // late result while waiting
    clock.advance(30_000)
    assertEquals(2, port.sends.size)
    assertTrue(reports.isEmpty())
  }

  @Test
  fun staleAttempt1ResultIgnoredDuringAttempt2() {
    enqueue("s1")
    results("s1", 1, PartResult.FAILED_RADIO, PartResult.FAILED_RADIO)
    clock.advance(30_000)
    results("s1", 1, PartResult.FAILED_OTHER, PartResult.FAILED_OTHER) // stale
    assertTrue(reports.isEmpty())
    results("s1", 2, PartResult.SENT, PartResult.SENT)
    assertEquals(done(PartResult.SENT, PartResult.SENT, attempts = 2), reports["s1"])
  }

  // --- Stop_List (3.8) ---

  @Test
  fun stopListHitBeforeFirstAttemptRefuses() {
    port.stopped = { it == a }
    enqueue("s1")
    assertEquals(SendReport.RefusedStopped, reports["s1"])
    assertTrue(port.sends.isEmpty())
    assertEquals(0, clock.pending())
    assertFalse(tracker.isSending)
  }

  @Test
  fun stopListHitBeforeRetryRefuses() {
    enqueue("s1")
    results("s1", 1, PartResult.FAILED_RADIO, PartResult.SENT)
    port.stopped = { it == a }
    clock.advance(30_000)
    assertEquals(SendReport.RefusedStopped, reports["s1"])
    assertEquals(1, port.sends.size)
    assertEquals(listOf(0L, 30_000L), port.stopChecks)
    assertEquals(listOf(true, false), states)
  }

  @Test
  fun stopListReadFailureRefuses() {
    port.stopped = { throw IllegalStateException("db") }
    enqueue("s1")
    assertEquals(SendReport.RefusedStopped, reports["s1"])
    assertTrue(port.sends.isEmpty())
    assertTrue(logs.any { it.contains("unreadable") })
  }

  @Test
  fun stopListReadFailureBeforeRetryRefuses() {
    enqueue("s1")
    results("s1", 1, PartResult.FAILED_NO_SERVICE, PartResult.SENT)
    port.stopped = { throw IllegalStateException("db") }
    clock.advance(30_000)
    assertEquals(SendReport.RefusedStopped, reports["s1"])
    assertEquals(1, port.sends.size)
  }

  // --- Invalid parts ---

  @Test
  fun invalidPartsAreAllFailedOtherWithoutSending() {
    port.valid = false
    enqueue("s1", parts = listOf("a", "b", "c"))
    assertEquals(done(PartResult.FAILED_OTHER, PartResult.FAILED_OTHER, PartResult.FAILED_OTHER, attempts = 1), reports["s1"])
    assertTrue(port.sends.isEmpty())
    assertEquals(0, clock.pending())
  }

  // --- Cancel (3.9) ---

  @Test
  fun cancelDuringRetryWait() {
    enqueue("s1")
    results("s1", 1, PartResult.FAILED_RADIO, PartResult.SENT)
    assertEquals(1, tracker.cancel(a))
    assertEquals(SendReport.Cancelled, reports["s1"])
    clock.advance(1_000_000)
    assertEquals(1, port.sends.size)
    assertEquals(0, clock.pending())
    assertFalse(tracker.isSending)
    assertEquals(listOf(true, false), states)
  }

  @Test
  fun cancelRemovesQueuedItemsOnlyForThatNumber() {
    enqueue("s1", number = b)
    enqueue("s2", number = a)
    enqueue("s3", number = b)
    enqueue("s4", number = a)
    assertEquals(2, tracker.cancel(a))
    assertEquals(SendReport.Cancelled, reports["s2"])
    assertEquals(SendReport.Cancelled, reports["s4"])
    results("s1", 1, PartResult.SENT, PartResult.SENT)
    assertEquals(listOf("s1", "s3"), port.sends.map { it.sendId })
  }

  @Test
  fun cancelDoesNotRecallAttemptInFlight() {
    enqueue("s1")
    assertEquals(0, tracker.cancel(a))
    assertTrue(reports.isEmpty())
    results("s1", 1, PartResult.SENT, PartResult.SENT)
    assertEquals(done(PartResult.SENT, PartResult.SENT, attempts = 1), reports["s1"])
  }

  @Test
  fun cancelInRetryWaitStartsNextItem() {
    enqueue("s1", number = a)
    enqueue("s2", number = b)
    results("s1", 1, PartResult.FAILED_RADIO, PartResult.SENT)
    tracker.cancel(a)
    assertEquals(listOf("s1", "s2"), port.sends.map { it.sendId })
    assertTrue(tracker.isSending)
  }

  // --- FIFO (8.7) ---

  @Test
  fun fifoSecondStartsOnlyAfterFirstCompletesIncludingRetryWait() {
    enqueue("s1", number = a)
    enqueue("s2", number = b)
    assertEquals(listOf("s1"), port.sends.map { it.sendId })
    results("s1", 1, PartResult.FAILED_RADIO, PartResult.SENT)
    clock.advance(29_999)
    assertEquals(listOf("s1"), port.sends.map { it.sendId })
    clock.advance(1)
    assertEquals(listOf("s1", "s1"), port.sends.map { it.sendId })
    results("s1", 2, PartResult.SENT, PartResult.SENT)
    assertEquals(listOf("s1", "s1", "s2"), port.sends.map { it.sendId })
    results("s2", 1, PartResult.SENT, PartResult.SENT)
    assertEquals(listOf("s1", "s2"), reports.keys.toList())
    assertEquals(listOf(true, false), states)
  }

  @Test
  fun refusedItemDoesNotBlockQueue() {
    port.stopped = { it == a }
    enqueue("s1", number = b)
    enqueue("s2", number = a)
    enqueue("s3", number = b)
    results("s1", 1, PartResult.SENT, PartResult.SENT)
    assertEquals(SendReport.RefusedStopped, reports["s2"])
    assertEquals(listOf("s1", "s3"), port.sends.map { it.sendId })
  }

  @Test
  fun sendStateTogglesPerBusyPeriod() {
    port.stopped = { it == a }
    enqueue("s0", number = a) // refused immediately
    enqueue("s1", number = b)
    results("s1", 1, PartResult.SENT, PartResult.SENT)
    enqueue("s2", number = b)
    results("s2", 1, PartResult.SENT, PartResult.SENT)
    assertEquals(listOf(true, false, true, false), states.drop(states.size - 4))
    assertEquals(false, states.last())
    // No consecutive duplicates.
    assertTrue(states.zipWithNext().all { (x, y) -> x != y })
  }
}
