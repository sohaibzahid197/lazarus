package dev.lazarus.necromancer.device

import android.telephony.ServiceState

/**
 * Snapshot of the phone conditions the Heartbeat_Model reads (Requirement 13.14).
 * Mirrors `DeviceStatusPayload` in `src/native/specs/NativeDevice.ts`.
 */
data class DeviceStatus(
  /** RECEIVE_SMS and SEND_SMS both granted. */
  val smsPermission: Boolean,
  val notificationPermission: Boolean,
  val batteryOptimisationIgnored: Boolean,
  val inService: Boolean,
  val airplaneMode: Boolean,
)

/** Pure decisions behind [DeviceStatusMonitor], so they run in JVM tests. */
object DeviceStatusDiff {
  /**
   * Cellular service before the first listener callback. Reported as in service so the
   * heartbeat does not flash `no-signal` while the listener is still registering; the
   * listener delivers the real state right after registration.
   */
  const val INITIAL_IN_SERVICE = true

  /** True when [next] must be emitted: there was no earlier status, or any field differs. */
  fun shouldEmit(previous: DeviceStatus?, next: DeviceStatus): Boolean = previous != next

  /** Only `STATE_IN_SERVICE` counts; emergency-only, out of service and power off do not. */
  fun inServiceFrom(serviceState: Int): Boolean = serviceState == ServiceState.STATE_IN_SERVICE
}
