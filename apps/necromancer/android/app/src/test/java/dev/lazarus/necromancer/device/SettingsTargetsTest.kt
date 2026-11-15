package dev.lazarus.necromancer.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsTargetsTest {
  private val autostart = SettingsTargets.autostart

  @Test
  fun autostartIsPreferredWhenItResolves() {
    assertEquals(listOf(0, 1, 2), SettingsTargets.candidates(autostart) { true })
  }

  @Test
  fun missingAutostartFallsBackToAppInfo() {
    val order = SettingsTargets.candidates(autostart) { it.component == null }
    assertEquals(SettingsTargets.APP_INFO, autostart[order.first()])
  }

  @Test
  fun batteryFallsBackToBatterySettingsThenAppInfo() {
    val chain = SettingsTargets.batteryOptimisation
    assertTrue(chain[0].withPackageUri)
    assertEquals(listOf(1, 2), SettingsTargets.candidates(chain) { it != chain[0] })
    assertEquals(listOf(2), SettingsTargets.candidates(chain) { it == SettingsTargets.APP_INFO })
  }

  @Test
  fun exactAlarmUsesPackageUriAndFallsBackToAppInfo() {
    val chain = SettingsTargets.exactAlarm
    assertEquals("android.settings.REQUEST_SCHEDULE_EXACT_ALARM", chain[0].action)
    assertTrue(chain[0].withPackageUri)
    val order = SettingsTargets.candidates(chain) { it != chain[0] }
    assertEquals(SettingsTargets.APP_INFO, chain[order.first()])
  }
  @Test
  fun nothingResolvesGivesNoCandidates() {
    assertEquals(emptyList<Int>(), SettingsTargets.candidates(SettingsTargets.mobileNetwork) { false })
  }
}
