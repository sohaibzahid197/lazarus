package dev.lazarus.necromancer.device

import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import dev.lazarus.necromancer.specs.NativeDeviceSpec

/**
 * TurboModule `NativeDevice`. Reports the Device_Status, emits `onDeviceStatus` when it
 * changes (service state, airplane-mode broadcast, app resume), checks Restricted_Settings
 * and opens the settings screens through [SettingsIntents].
 */
class DeviceModule(reactContext: ReactApplicationContext) :
  NativeDeviceSpec(reactContext), LifecycleEventListener {

  private val monitor = DeviceStatusMonitor(reactContext) { emitOnDeviceStatus(toMap(it)) }
  private val restricted = RestrictedSettings(reactContext)
  private val settings = SettingsIntents { currentContext() }

  override fun initialize() {
    super.initialize()
    reactApplicationContext.addLifecycleEventListener(this)
    monitor.start()
  }

  override fun invalidate() {
    reactApplicationContext.removeLifecycleEventListener(this)
    monitor.stop()
    super.invalidate()
  }

  override fun onHostResume() {
    monitor.recheck()
  }

  override fun onHostPause() = Unit

  override fun onHostDestroy() = Unit

  override fun getDeviceStatus(promise: Promise) = guard(promise) {
    promise.resolve(toMap(monitor.recheck()))
  }

  override fun isRestrictedSettingsBlocked(promise: Promise) = guard(promise) {
    promise.resolve(restricted.isBlocked())
  }

  override fun openAppInfo(promise: Promise) = onUi(promise) {
    settings.openAppInfo()
    null
  }

  override fun openAutostart(promise: Promise) = onUi(promise) { settings.openAutostart() }

  override fun requestIgnoreBatteryOptimisation(promise: Promise) =
    onUi(promise) { settings.requestIgnoreBatteryOptimisation() }

  override fun openAirplaneSettings(promise: Promise) = onUi(promise) {
    settings.openAirplaneSettings()
    null
  }

  override fun openMobileNetworkSettings(promise: Promise) = onUi(promise) {
    settings.openMobileNetworkSettings()
    null
  }

  private fun currentContext(): Context = reactApplicationContext.currentActivity ?: reactApplicationContext

  private fun onUi(promise: Promise, work: () -> Any?) {
    reactApplicationContext.runOnUiQueueThread { guard(promise) { promise.resolve(work()) } }
  }

  private fun guard(promise: Promise, work: () -> Unit) {
    try {
      work()
    } catch (e: Exception) {
      promise.reject(E_DEVICE, "Device call failed (${e.javaClass.simpleName})")
    }
  }

  private fun toMap(status: DeviceStatus): WritableMap = Arguments.createMap().apply {
    putBoolean("smsPermission", status.smsPermission)
    putBoolean("notificationPermission", status.notificationPermission)
    putBoolean("batteryOptimisationIgnored", status.batteryOptimisationIgnored)
    putBoolean("inService", status.inService)
    putBoolean("airplaneMode", status.airplaneMode)
  }

  companion object {
    const val NAME = NativeDeviceSpec.NAME
    private const val E_DEVICE = "E_DEVICE"
  }
}
