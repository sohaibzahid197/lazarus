package dev.lazarus.necromancer.keystore

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import dev.lazarus.necromancer.specs.NativeKeyStoreSpec
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * TurboModule `NativeKeyStore`. Storage work runs on one background thread, so calls
 * keep their order and never block the JS thread. The key leaves native code only as
 * the `readKey` promise result; this module emits no events and logs nothing itself.
 * Rejections carry a fixed message and no cause, so no key text can leak through them.
 */
class KeyStoreModule(
  reactContext: ReactApplicationContext,
  private val store: ApiKeyStore = EncryptedApiKeyStore(reactContext),
) : NativeKeyStoreSpec(reactContext) {
  private val executor: ExecutorService = Executors.newSingleThreadExecutor { r ->
    Thread(r, "lazarus-keystore")
  }

  override fun readKey(promise: Promise) = onStore(promise, "read") {
    val result = store.read()
    Arguments.createMap().apply {
      putString("status", result.status)
      if (result is KeyRead.Present) putString("key", result.key) else putNull("key")
    }
  }

  override fun saveKey(key: String, promise: Promise) {
    if (key.isBlank()) {
      promise.reject(E_INVALID, "Key is empty")
      return
    }
    onStore(promise, "save") {
      store.write(key)
      null
    }
  }

  override fun deleteKey(promise: Promise) = onStore(promise, "delete") {
    store.delete()
    null
  }

  override fun invalidate() {
    executor.shutdown()
    super.invalidate()
  }

  private fun onStore(promise: Promise, op: String, work: () -> Any?) {
    try {
      executor.execute {
        try {
          promise.resolve(work())
        } catch (e: Exception) {
          promise.reject(E_STORE, "Key store $op failed (${e.javaClass.simpleName})")
        }
      }
    } catch (e: RejectedExecutionException) {
      promise.reject(E_STORE, "Key store $op failed (module closed)")
    }
  }

  companion object {
    const val NAME = NativeKeyStoreSpec.NAME
    private const val E_STORE = "E_KEY_STORE"
    private const val E_INVALID = "E_INVALID_KEY"
  }
}
