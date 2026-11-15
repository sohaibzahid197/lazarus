package dev.lazarus.necromancer.device

import android.app.AppOpsManager
import android.telephony.ServiceState
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceStatusDiffTest {
  private val base = DeviceStatus(
    smsPermission = true,
    notificationPermission = true,
    batteryOptimisationIgnored = true,
    inService = true,
    airplaneMode = false,
  )

  @Test
  fun firstStatusIsAlwaysEmitted() {
    assertTrue(DeviceStatusDiff.shouldEmit(null, base))
  }

  @Test
  fun sameStatusIsNotEmittedAgain() {
    assertFalse(DeviceStatusDiff.shouldEmit(base, base.copy()))
  }

  @Test
  fun anyChangedFieldIsEmitted() {
    val changes = listOf(
      base.copy(smsPermission = false),
      base.copy(notificationPermission = false),
      base.copy(batteryOptimisationIgnored = false),
      base.copy(inService = false),
      base.copy(airplaneMode = true),
    )
    changes.forEach { assertTrue(DeviceStatusDiff.shouldEmit(base, it)) }
  }

  @Test
  fun onlyInServiceCountsAsService() {
    assertTrue(DeviceStatusDiff.inServiceFrom(ServiceState.STATE_IN_SERVICE))
    assertFalse(DeviceStatusDiff.inServiceFrom(ServiceState.STATE_OUT_OF_SERVICE))
    assertFalse(DeviceStatusDiff.inServiceFrom(ServiceState.STATE_EMERGENCY_ONLY))
    assertFalse(DeviceStatusDiff.inServiceFrom(ServiceState.STATE_POWER_OFF))
  }

  @Test
  fun initialServiceDoesNotFlashNoSignal() {
    assertTrue(DeviceStatusDiff.INITIAL_IN_SERVICE)
  }

  @Test
  fun erroredOrIgnoredAppOpMeansBlocked() {
    assertTrue(RestrictedSettings.isBlockedMode(AppOpsManager.MODE_ERRORED))
    assertTrue(RestrictedSettings.isBlockedMode(AppOpsManager.MODE_IGNORED))
    assertFalse(RestrictedSettings.isBlockedMode(AppOpsManager.MODE_ALLOWED))
    assertFalse(RestrictedSettings.isBlockedMode(AppOpsManager.MODE_DEFAULT))
  }
}
