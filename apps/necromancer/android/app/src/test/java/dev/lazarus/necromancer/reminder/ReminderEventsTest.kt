package dev.lazarus.necromancer.reminder

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The receiver-to-ReminderModule hook. Validates: Requirements 11.4, 11.6 */
class ReminderEventsTest {
  @After
  fun clear() {
    ReminderEvents.onRemindersDue = null
  }

  @Test
  fun noListenerReportsNotDelivered() {
    assertFalse(ReminderEvents.isListening)
    assertFalse(ReminderEvents.notifyDue())
  }

  @Test
  fun listenerIsCalledOncePerNotify() {
    var calls = 0
    ReminderEvents.onRemindersDue = { calls++ }
    assertTrue(ReminderEvents.isListening)
    assertTrue(ReminderEvents.notifyDue())
    assertEquals(1, calls)
  }
}
