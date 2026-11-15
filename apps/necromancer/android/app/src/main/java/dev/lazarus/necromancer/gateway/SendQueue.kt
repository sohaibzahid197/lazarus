package dev.lazarus.necromancer.gateway

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import dev.lazarus.necromancer.store.LazarusDb
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Process singleton that runs [SendTracker] on its own [HandlerThread] (design `SendQueue`).
 *
 * A partial wake lock is held while any send is queued, in flight or waiting for its retry,
 * so the 60 s Send_Timeout and the 30 s retry wait run on time while the screen is off.
 */
class SendQueue private constructor(context: Context) {
  private val appContext = context.applicationContext
  private val thread = HandlerThread("lazarus-send").apply { start() }
  private val handler = Handler(thread.looper)
  private val sender = SmsSender(appContext)
  private val listeners = LinkedHashMap<Int, (Boolean) -> Unit>()
  private val nextListenerId = AtomicInteger(1)
  private var wakeLock: PowerManager.WakeLock? = null

  @Volatile var isSending: Boolean = false
    private set

  private val tracker = SendTracker(
    scheduler = object : SendScheduler {
      override fun postDelayed(delayMs: Long, action: () -> Unit): () -> Unit {
        val runnable = Runnable { action() }
        handler.postDelayed(runnable, delayMs)
        return { handler.removeCallbacks(runnable) }
      }
    },
    port = object : SendPort {
      override fun isStopped(number: String): Boolean = LazarusDb.get(appContext).isStopped(number)
      override fun partsValid(parts: List<String>): Boolean = sender.partsValid(parts)
      override fun send(sendId: String, attempt: Int, number: String, parts: List<String>) {
        acquireWakeLock() // refreshes the timeout for each attempt of a long queue
        sender.send(sendId, attempt, number, parts)
      }
    },
    onSendState = ::emitSendState,
    log = { Log.i(TAG, it) },
  )

  /** Hands Reply_Parts to the Sms_Sender; [onComplete] runs once, on the send thread. */
  fun enqueue(sendId: String, number: String, parts: List<String>, onComplete: (SendReport) -> Unit) {
    val copy = parts.toList()
    handler.post { tracker.enqueue(sendId, number, copy, onComplete) }
  }

  /** Cancels queued and retry-waiting sends for [number] (Requirement 3.9); returns how many. */
  fun cancel(number: String): Int {
    if (Looper.myLooper() == thread.looper) return tracker.cancel(number)
    val latch = CountDownLatch(1)
    val count = AtomicInteger(0)
    handler.post {
      count.set(tracker.cancel(number))
      latch.countDown()
    }
    // The cancel still runs if this wait times out; only the returned count is then 0.
    if (!latch.await(CANCEL_WAIT_MS, TimeUnit.MILLISECONDS)) Log.w(TAG, "SendQueue: cancel count not ready")
    return count.get()
  }

  /** Called by [SendResultReceiver] on the main thread. */
  fun onPartResult(sendId: String, attempt: Int, partIndex: Int, result: PartResult) {
    handler.post { tracker.onPartResult(sendId, attempt, partIndex, result) }
  }

  /** Sending-state listener for `onSendState`; returns an id for [removeSendStateListener]. */
  fun addSendStateListener(listener: (Boolean) -> Unit): Int {
    val id = nextListenerId.getAndIncrement()
    synchronized(listeners) { listeners[id] = listener }
    return id
  }

  fun removeSendStateListener(id: Int) {
    synchronized(listeners) { listeners.remove(id) }
  }

  private fun emitSendState(sending: Boolean) {
    isSending = sending
    if (sending) acquireWakeLock() else releaseWakeLock()
    val current = synchronized(listeners) { listeners.values.toList() }
    current.forEach { listener ->
      try {
        listener(sending)
      } catch (e: RuntimeException) {
        Log.w(TAG, "SendQueue: send-state listener failed (${e.javaClass.simpleName})")
      }
    }
  }

  @SuppressLint("WakelockTimeout")
  private fun acquireWakeLock() {
    val lock = wakeLock ?: run {
      val pm = appContext.getSystemService(PowerManager::class.java) ?: return
      pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply { setReferenceCounted(false) }
        .also { wakeLock = it }
    }
    lock.acquire(WAKE_LOCK_MAX_MS)
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
  }

  companion object {
    private const val TAG = "Lazarus"
    private const val WAKE_LOCK_TAG = "Lazarus:gateway-sending"
    private const val CANCEL_WAIT_MS = 5_000L

    /** Bounds a lost release; long enough for timeout + retry wait + timeout of a few queued sends. */
    private const val WAKE_LOCK_MAX_MS = 10 * 60_000L

    @Volatile private var instance: SendQueue? = null

    fun get(context: Context): SendQueue =
      instance ?: synchronized(this) {
        instance ?: SendQueue(context).also { instance = it }
      }
  }
}
