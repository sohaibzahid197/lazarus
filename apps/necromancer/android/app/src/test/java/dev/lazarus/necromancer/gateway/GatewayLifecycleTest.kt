package dev.lazarus.necromancer.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GatewayLifecycleTest {
  @Test fun restartIsScheduledUnlessPaused() {
    assertTrue(GatewayLifecycle.shouldScheduleRestart(false))
    assertFalse(GatewayLifecycle.shouldScheduleRestart(true))
    assertTrue(GatewayLifecycle.shouldScheduleRestart(null))
  }

  @Test fun startRunsUnlessPaused() {
    assertTrue(GatewayLifecycle.shouldRunOnStart(false))
    assertFalse(GatewayLifecycle.shouldRunOnStart(true))
  }

  @Test fun restartDelayIsFiveSeconds() {
    assertEquals(5_000L, GatewayLifecycle.RESTART_DELAY_MS)
  }

  @Test fun exactAlarmOnlyWhenAllowed() {
    assertEquals(GatewayLifecycle.AlarmMode.EXACT, GatewayLifecycle.alarmMode(30, false))
    assertEquals(GatewayLifecycle.AlarmMode.EXACT, GatewayLifecycle.alarmMode(34, true))
    assertEquals(GatewayLifecycle.AlarmMode.INEXACT, GatewayLifecycle.alarmMode(34, false))
  }

  @Test fun pausedWinsInServiceStatus() {
    assertEquals("paused", GatewayLifecycle.serviceStatus(running = true, paused = true))
    assertEquals("running", GatewayLifecycle.serviceStatus(running = true, paused = false))
    assertEquals("stopped", GatewayLifecycle.serviceStatus(running = false, paused = false))
  }
}

class GatewayNotificationTextTest {
  @Test fun showsStateWordAndCount() {
    assertEquals("Lazarus is ALIVE · 12 replies today", GatewayNotificationText.text("ALIVE", 12))
    assertEquals("Lazarus is SENDING · 1 reply today", GatewayNotificationText.text("sending", 1))
    assertEquals("Lazarus is SLEEPING · 0 replies today", GatewayNotificationText.text("SLEEPING", -4))
  }

  @Test fun unknownWordNeverReachesTheText() {
    // A number or body passed by mistake must not appear (Requirement 9.2).
    val text = GatewayNotificationText.text("+923001234567 hello", 3)
    assertEquals("Lazarus is ALIVE · 3 replies today", text)
    assertFalse(text.contains("923"))
    assertFalse(text.contains("hello"))
  }
}
