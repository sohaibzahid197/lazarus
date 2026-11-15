package dev.lazarus.necromancer.gateway

import dev.lazarus.necromancer.gateway.BootDecision.Boot
import dev.lazarus.necromancer.gateway.BootDecision.Watchdog
import org.junit.Assert.assertEquals
import org.junit.Test

/** Boot and watchdog decisions. Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5 */
class BootDecisionTest {

  private val actions =
    listOf(BootDecision.ACTION_BOOT_COMPLETED, BootDecision.ACTION_MY_PACKAGE_REPLACED)

  @Test
  fun bothActionsStartAndWatchWhenNotPaused() {
    for (action in actions) {
      assertEquals(action, Boot.START_AND_WATCH, BootDecision.onBoot(action, false))
    }
  }

  @Test
  fun bothActionsDoNothingWhenPaused() {
    for (action in actions) {
      assertEquals(action, Boot.NOTHING, BootDecision.onBoot(action, true))
    }
  }

  @Test
  fun unreadablePausedFlagCountsAsNotPaused() {
    for (action in actions) {
      assertEquals(action, Boot.START_AND_WATCH, BootDecision.onBoot(action, null))
    }
  }

  @Test
  fun unknownOrNullActionDoesNothing() {
    val others = listOf(null, "", "android.intent.action.SCREEN_ON", "boot_completed")
    for (action in others) {
      for (paused in listOf(true, false, null)) {
        assertEquals("$action/$paused", Boot.NOTHING, BootDecision.onBoot(action, paused))
      }
    }
  }

  @Test
  fun actionConstantsMatchAndroid() {
    assertEquals("android.intent.action.BOOT_COMPLETED", BootDecision.ACTION_BOOT_COMPLETED)
    assertEquals(
      "android.intent.action.MY_PACKAGE_REPLACED",
      BootDecision.ACTION_MY_PACKAGE_REPLACED,
    )
  }

  @Test
  fun watchdogNotifiesOnlyWhenNotRunningAndNotPaused() {
    assertEquals(Watchdog.NOTIFY, BootDecision.watchdog(running = false, paused = false))
    assertEquals(Watchdog.NOTIFY, BootDecision.watchdog(running = false, paused = null))
    assertEquals(Watchdog.NOTHING, BootDecision.watchdog(running = false, paused = true))
    assertEquals(Watchdog.NOTHING, BootDecision.watchdog(running = true, paused = false))
    assertEquals(Watchdog.NOTHING, BootDecision.watchdog(running = true, paused = null))
    assertEquals(Watchdog.NOTHING, BootDecision.watchdog(running = true, paused = true))
  }

  @Test
  fun watchdogDelayIsSixtySeconds() {
    assertEquals(60_000L, BootDecision.WATCHDOG_DELAY_MS)
  }
}
