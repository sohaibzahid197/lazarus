package dev.lazarus.necromancer.reminder

import dev.lazarus.necromancer.gateway.GatewayLifecycle.AlarmMode
import dev.lazarus.necromancer.reminder.ReminderScheduler.Outcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Single reminder alarm scheduling. Validates: Requirements 11.1, 11.2, 11.10, 11.13, 14.8 */
class ReminderSchedulerTest {
  /** Models AlarmManager with one PendingIntent: any set replaces the pending alarm. */
  private class FakeAlarmPort(
    override val sdkInt: Int = 33,
    var canExact: Boolean = true,
    var exactThrows: Boolean = false,
  ) : ReminderScheduler.AlarmPort {
    data class Pending(val atMs: Long, val mode: AlarmMode)

    val pending = mutableListOf<Pending>()
    var cancels = 0

    override fun canScheduleExact(): Boolean = canExact

    override fun setExact(atMs: Long) {
      if (exactThrows) throw SecurityException("exact alarm access withdrawn")
      pending.clear()
      pending.add(Pending(atMs, AlarmMode.EXACT))
    }

    override fun setInexact(atMs: Long) {
      pending.clear()
      pending.add(Pending(atMs, AlarmMode.INEXACT))
    }

    override fun cancel() {
      cancels++
      pending.clear()
    }
  }

  private val now = 1_700_000_000_000L
  private val logs = mutableListOf<String>()

  private fun scheduler(port: FakeAlarmPort, nextDue: () -> Long?) =
    ReminderScheduler(port, nextDue, { now }, { logs.add(it) })

  /** Logs are fixed strings: no digit from a number, a Due_Time or a reminder text. */
  private fun assertLogsHaveNoDigits() {
    assertTrue(logs.isNotEmpty())
    for (line in logs) assertFalse(line, line.any { it.isDigit() })
  }

  @Test
  fun armingTwiceLeavesOnePendingAlarm() {
    val port = FakeAlarmPort()
    var due = now + 3_600_000L
    val s = scheduler(port) { due }
    s.reschedule()
    due = now + 7_200_000L
    val outcome = s.reschedule()
    assertEquals(Outcome.Armed(now + 7_200_000L, AlarmMode.EXACT), outcome)
    assertEquals(listOf(FakeAlarmPort.Pending(now + 7_200_000L, AlarmMode.EXACT)), port.pending)
    assertLogsHaveNoDigits()
  }

  @Test
  fun noRowsCancelsTheAlarm() {
    val port = FakeAlarmPort()
    var due: Long? = now + 3_600_000L
    val s = scheduler(port) { due }
    s.reschedule()
    due = null
    assertEquals(Outcome.Cancelled, s.reschedule())
    assertTrue(port.pending.isEmpty())
    assertEquals(1, port.cancels)
    assertLogsHaveNoDigits()
  }

  @Test
  fun securityExceptionFallsBackToInexactForSameTime() {
    val port = FakeAlarmPort(sdkInt = 31, canExact = true, exactThrows = true)
    val due = now + 3_600_000L
    val outcome = scheduler(port) { due }.reschedule()
    assertEquals(Outcome.Armed(due, AlarmMode.INEXACT), outcome)
    assertEquals(listOf(FakeAlarmPort.Pending(due, AlarmMode.INEXACT)), port.pending)
    assertLogsHaveNoDigits()
  }

  @Test
  fun inexactWithoutExactAccessOnApi31() {
    val port = FakeAlarmPort(sdkInt = 31, canExact = false)
    val due = now + 3_600_000L
    assertEquals(Outcome.Armed(due, AlarmMode.INEXACT), scheduler(port) { due }.reschedule())
  }

  @Test
  fun retryIn60sArmsNowPlus60000() {
    val port = FakeAlarmPort()
    val s = scheduler(port) { now + 3_600_000L }
    s.reschedule()
    assertEquals(Outcome.Retry(now + 60_000L, AlarmMode.EXACT), s.retryIn60s())
    assertEquals(listOf(FakeAlarmPort.Pending(now + 60_000L, AlarmMode.EXACT)), port.pending)
    assertLogsHaveNoDigits()
  }

  @Test
  fun unreadableStoreRetriesIn60sWithoutLeakingTheMessage() {
    val port = FakeAlarmPort()
    val s = scheduler(port) { throw IllegalStateException("+923001234567 REMIND 5pm take 2 pills") }
    assertEquals(Outcome.Retry(now + 60_000L, AlarmMode.EXACT), s.reschedule())
    assertEquals(listOf(FakeAlarmPort.Pending(now + 60_000L, AlarmMode.EXACT)), port.pending)
    for (line in logs) {
      assertFalse(line, line.contains("pills") || line.contains("REMIND"))
    }
    assertLogsHaveNoDigits()
  }

  @Test
  fun overdueReminderIsFlooredAtNowPlus5sOr15MinWhenPaused() {
    val port = FakeAlarmPort()
    val s = scheduler(port) { now - 1_000L }
    assertEquals(Outcome.Armed(now + 5_000L, AlarmMode.EXACT), s.reschedule())
    assertEquals(Outcome.Armed(now + 900_000L, AlarmMode.EXACT), s.reschedule(paused = true))
    assertEquals(listOf(FakeAlarmPort.Pending(now + 900_000L, AlarmMode.EXACT)), port.pending)
  }
}
