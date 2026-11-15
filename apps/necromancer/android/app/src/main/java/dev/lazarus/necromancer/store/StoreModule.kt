package dev.lazarus.necromancer.store

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import dev.lazarus.necromancer.specs.NativeStoreSpec
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * TurboModule `NativeStore` over [LazarusDb]. All calls run in order on one background
 * thread. Rejections carry only the exception class, never a number or message text.
 * Registered in `LazarusPackage` (task 20.5).
 */
class StoreModule(reactContext: ReactApplicationContext) : NativeStoreSpec(reactContext) {
  private val db: LazarusDb by lazy { LazarusDb.get(reactApplicationContext) }

  override fun loadState(promise: Promise) = io(promise) { StoreWire.encodeState(db.loadSnapshot()) }

  override fun commit(changesJson: String, promise: Promise) =
    io(promise) {
      db.commit(StoreWire.parseChanges(changesJson))
      null
    }

  override fun saveSettings(raw: String, promise: Promise) =
    io(promise) {
      db.saveSettings(raw)
      null
    }

  override fun appendActivity(entryJson: String, promise: Promise) =
    io(promise) {
      db.appendActivity(StoreWire.parseActivity(entryJson))
      null
    }

  override fun applyPendingStop(id: Double, changesJson: String, entryJson: String, promise: Promise) =
    io(promise) {
      val rowId = StoreWire.time(id, "pending stop id")
      db.applyPendingStop(rowId, StoreWire.parseChanges(changesJson), StoreWire.parseActivity(entryJson))
    }

  override fun savePendingStop(sender: String, receivedAt: Double, promise: Promise) =
    io(promise) {
      db.insertPendingStop(sender, StoreWire.time(receivedAt, "receivedAt"))
      null
    }

  override fun loadActivity(promise: Promise) = io(promise) { StoreWire.encodeActivity(db.readActivity()) }

  override fun clearActivity(promise: Promise) =
    io(promise) {
      db.clearActivity()
      null
    }

  override fun getSetupMarks(promise: Promise) = io(promise) { StoreWire.encodeSetupMarks(db.readSetupMarks()) }

  override fun setSetupMark(step: String, done: Boolean, promise: Promise) =
    io(promise) {
      db.setSetupMark(step, done)
      null
    }

  private fun io(promise: Promise, block: () -> Any?) {
    executor.execute {
      try {
        promise.resolve(block())
      } catch (e: Exception) {
        promise.reject(ERROR_CODE, "NativeStore failed (${e.javaClass.simpleName})")
      }
    }
  }

  companion object {
    const val NAME = NativeStoreSpec.NAME
    private const val ERROR_CODE = "E_STORE"

    /** Process-wide so a reloaded module keeps the same write order. */
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "lazarus-store") }
  }
}
