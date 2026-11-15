package dev.lazarus.necromancer

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import dev.lazarus.necromancer.device.DeviceModule
import dev.lazarus.necromancer.gateway.GatewayModule
import dev.lazarus.necromancer.keystore.KeyStoreModule
import dev.lazarus.necromancer.reminder.ReminderModule
import dev.lazarus.necromancer.store.StoreModule

/** Registers the five Lazarus TurboModules with React Native. */
class LazarusPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    when (name) {
      GatewayModule.NAME -> GatewayModule(reactContext)
      StoreModule.NAME -> StoreModule(reactContext)
      DeviceModule.NAME -> DeviceModule(reactContext)
      KeyStoreModule.NAME -> KeyStoreModule(reactContext)
      ReminderModule.NAME -> ReminderModule(reactContext)
      else -> null
    }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    listOf(
      GatewayModule.NAME to GatewayModule::class.java.name,
      StoreModule.NAME to StoreModule::class.java.name,
      DeviceModule.NAME to DeviceModule::class.java.name,
      KeyStoreModule.NAME to KeyStoreModule::class.java.name,
      ReminderModule.NAME to ReminderModule::class.java.name,
    ).associate { (name, className) -> name to turboModuleInfo(name, className) }
  }

  private fun turboModuleInfo(name: String, className: String) =
    ReactModuleInfo(
      name,
      className,
      canOverrideExistingModule = false,
      needsEagerInit = false,
      isCxxModule = false,
      isTurboModule = true,
    )
}
