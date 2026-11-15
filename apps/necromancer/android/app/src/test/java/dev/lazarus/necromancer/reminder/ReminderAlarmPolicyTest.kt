package dev.lazarus.necromancer.reminder

import dev.lazarus.necromancer.gateway.GatewayLifecycle.AlarmMode
import dev.lazarus.necromancer.reminder.ReminderAlarmPolicy.TriggerAction
import org.junit.Assert.assertEquals
import org.junit.Test

/** Alarm mode and trigger decisions. Validates: Requirements 11.1, 11.2, 14.8 */
class ReminderAlarmPolicyTest {
  @Test
  fun exactOnApi26And30RegardlessOfAccess() {
    for (sdk in listOf(26, 30)) {
      assertEquals("sdk $sdk", AlarmMode.EXACT, ReminderAlarmPolicy.mode(sdk, false))
      assertEquals("sdk $sdk", AlarmMode.EXACT, ReminderAlarmPolicy.mode(sdk, true))
    }
  }

  @Test
  fun exactOnApi31WithAccess() {
    assertEquals(AlarmMode.EXACT, ReminderAlarmPolicy.mode(31, true))
  }

  @Test
  fun inexactOnApi31WithoutAccess() {
    assertEquals(AlarmMode.INEXACT, ReminderAlarmPolicy.mode(31, false))
  }

  @Test
  fun onTriggerTable() {
    val bools = listOf(false, true)
    for (running in bools) {
      for (attached in bools) {
        assertEquals(
          "paused running=$running attached=$attached",
          TriggerAction.RESCHEDULE_ONLY,
          ReminderAlarmPolicy.onTrigger(paused = true, serviceRunning = running, loopAttached = attached),
        )
      }
    }
    assertEquals(TriggerAction.NOTIFY_LOOP, ReminderAlarmPolicy.onTrigger(false, true, true))
    assertEquals(TriggerAction.START_SERVICE, ReminderAlarmPolicy.onTrigger(false, true, false))
    assertEquals(TriggerAction.START_SERVICE, ReminderAlarmPolicy.onTrigger(false, false, false))
    assertEquals(TriggerAction.START_SERVICE, ReminderAlarmPolicy.onTrigger(false, false, true))
  }
}
