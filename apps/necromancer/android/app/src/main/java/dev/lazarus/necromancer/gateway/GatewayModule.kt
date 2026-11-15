package dev.lazarus.necromancer.gateway

import android.content.Context
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import dev.lazarus.necromancer.specs.NativeGatewaySpec
import dev.lazarus.necromancer.store.LazarusDb
import dev.lazarus.necromancer.store.StoreWire
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * TurboModule `NativeGateway`: service control, the pull-model inbox (`onInboundAvailable` →
 * `takeNextInbound` → `completeInbound`), multipart sending, pending STOPs and the notification.
 *
 * `waitForInbound` is not native: the JS ports build it on `onInboundAvailable`.
 * Storage and blocking calls run on one background thread. Rejections carry only the
 * exception class, never a number or message text.
 */
class GatewayModule(reactContext: ReactApplicationContext) : NativeGatewaySpec(reactContext) {
  private val appContext: Context = reactContext.applicationContext
  private var sendStateListenerId: Int? = null
  private var loopAttached = false
  private val runningListener: (Boolean) -> Unit = { emitStatus() }

  override fun initialize() {
    super.initialize()
    sendStateListenerId = SendQueue.get(appContext).addSendStateListener { emitOnSendState(it) }
    GatewayService.onRunningChanged = runningListener
  }

  override fun invalidate() {
    sendStateListenerId?.let { SendQueue.get(appContext).removeSendStateListener(it) }
    sendStateListenerId = null
    if (GatewayService.onRunningChanged === runningListener) GatewayService.onRunningChanged = null
    // A reloaded JS loop attaches again; until then the receiver stores to pending_inbox.
    if (loopAttached) InboxQueue.get(appContext).detach()
    loopAttached = false
    super.invalidate()
  }

  // ---- service control (Requirements 9.1, 9.5, 9.8) ----

  override fun startService(promise: Promise) = io(promise) {
    startOrThrow()
    null
  }

  override fun pauseService(promise: Promise) = io(promise) {
    // Persist first: onDestroy reads the flag and must not schedule a restart (Requirement 9.5).
    LazarusDb.get(appContext).setPaused(true)
    GatewayService.stop(appContext)
    GatewayNotification.cancel(appContext)
    emitStatus()
    null
  }

  override fun resumeService(promise: Promise) = io(promise) {
    LazarusDb.get(appContext).setPaused(false)
    startOrThrow()
    null
  }

  override fun getServiceStatus(promise: Promise) = io(promise) { GatewayService.status(appContext) }

  // ---- inbox (Requirements 1.4, 1.7) ----

  override fun attachLoop() {
    loopAttached = true
    InboxQueue.get(appContext).attach { emitOnInboundAvailable() }
  }

  override fun takeNextInbound(promise: Promise) = guard(promise) {
    val message = InboxQueue.get(appContext).takeNext()
    if (message != null) GatewayService.acquireProcessingWakeLock(appContext)
    promise.resolve(message?.let(::toPayload))
  }

  override fun completeInbound(id: String, promise: Promise) {
    executor.execute {
      val inbox = InboxQueue.get(appContext)
      try {
        inbox.complete(id)
        promise.resolve(null)
      } catch (e: Exception) {
        reject(promise, e)
      } finally {
        if (inbox.waitingCount() == 0) GatewayService.releaseProcessingWakeLock()
      }
    }
  }

  // ---- sending ----

  override fun sendParts(sendId: String, number: String, parts: ReadableArray, promise: Promise) =
    guard(promise) {
      val list = toStringList(parts)
      SendQueue.get(appContext).enqueue(sendId, number, list) { report -> promise.resolve(toReportMap(report)) }
    }

  override fun cancelPendingSends(number: String, promise: Promise) =
    io(promise) { SendQueue.get(appContext).cancel(number).toDouble() }

  // ---- pending STOPs (Requirement 9.15); rows are deleted by NativeStore.applyPendingStop ----

  override fun takePendingStops(promise: Promise) =
    io(promise) { StoreWire.encodePendingStops(LazarusDb.get(appContext).readPendingStops()) }

  // ---- notification (Requirement 9.2) ----

  override fun updateNotification(stateWord: String, repliedToday: Double) {
    val replied = if (repliedToday.isFinite()) repliedToday.toInt().coerceAtLeast(0) else 0
    try {
      GatewayService.updateNotification(appContext, stateWord, replied)
    } catch (e: RuntimeException) {
      Log.w(TAG, "GatewayModule: notification update failed (${e.javaClass.simpleName})")
    }
  }

  // ---- helpers ----

  private fun startOrThrow() {
    if (!GatewayService.start(appContext)) throw ServiceStartRefusedException()
  }

  private fun emitStatus() {
    executor.execute {
      try {
        emitOnServiceStatus(GatewayService.status(appContext))
      } catch (e: RuntimeException) {
        Log.w(TAG, "GatewayModule: status emit failed (${e.javaClass.simpleName})")
      }
    }
  }

  private fun io(promise: Promise, block: () -> Any?) {
    executor.execute { guard(promise) { promise.resolve(block()) } }
  }

  private fun guard(promise: Promise, work: () -> Unit) {
    try {
      work()
    } catch (e: Exception) {
      reject(promise, e)
    }
  }

  private fun reject(promise: Promise, e: Exception) {
    promise.reject(ERROR_CODE, "NativeGateway failed (${e.javaClass.simpleName})")
  }

  /** Thrown when Android refuses `startForegroundService`; JS sees only the class name. */
  class ServiceStartRefusedException : IllegalStateException()

  companion object {
    const val NAME = NativeGatewaySpec.NAME
    private const val TAG = "Lazarus"
    private const val ERROR_CODE = "E_GATEWAY"

    /** Process-wide so a reloaded module keeps one order for pause/resume and completes. */
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "lazarus-gateway") }

    private fun toPayload(m: InboundMessage): WritableMap = Arguments.createMap().apply {
      putString("id", m.id)
      putDouble("seq", m.seq.toDouble())
      putString("sender", m.sender)
      putString("body", m.body)
      putDouble("receivedAt", m.receivedAt.toDouble())
    }

    private fun toReportMap(report: SendReport): WritableMap = Arguments.createMap().apply {
      putString("status", report.status)
      putArray("results", Arguments.createArray().apply { report.wireResults.forEach(::pushString) })
      putDouble("attempts", report.wireAttempts.toDouble())
    }

    private fun toStringList(parts: ReadableArray): List<String> =
      List(parts.size()) { i ->
        require(parts.getType(i) == ReadableType.String) { "parts must be strings" }
        parts.getString(i) ?: throw IllegalArgumentException("parts must be strings")
      }
  }
}
