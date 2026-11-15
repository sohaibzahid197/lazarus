package dev.lazarus.necromancer.gateway

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import dev.lazarus.necromancer.store.LazarusDb

/**
 * Long-lived specialUse foreground service that hosts the `LazarusGateway` Headless JS task
 * in the app's shared ReactHost (Requirement 9.1, 9.4, 9.6).
 *
 * The task is started by hand instead of through [startTask]: the base class would hold its
 * partial wake lock for the whole life of the task (timeout 0), and it would stop this service
 * when any other headless task (e.g. `LazarusPausedInbox`) finishes. Here the wake lock is held
 * only while a message is processed ([acquireProcessingWakeLock]/[releaseProcessingWakeLock]),
 * and only our own task id ends the service.
 */
class GatewayService : HeadlessJsTaskService() {
  private var taskId: Int? = null
  private var taskStarting = false
  private var stopRequested = false

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // startForegroundService requires startForeground in every start, even when we stop at once.
    if (!enterForeground()) {
      stopRequested = true
      stopSelf()
      return START_NOT_STICKY
    }
    if (!GatewayLifecycle.shouldRunOnStart(readPausedOrNull(this))) {
      stopRequested = true
      stopSelf()
      return START_NOT_STICKY
    }
    setRunning(true)
    cancelRestart(this)
    if (taskId == null && !taskStarting) {
      loadPendingInbox()
      startGatewayTask()
    }
    return START_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    super.onTaskRemoved(rootIntent)
    if (GatewayLifecycle.shouldScheduleRestart(readPausedOrNull(this))) scheduleRestart(this)
  }

  override fun onDestroy() {
    setRunning(false)
    releaseProcessingWakeLock()
    InboxQueue.get(this).detach()
    if (!stopRequested && GatewayLifecycle.shouldScheduleRestart(readPausedOrNull(this))) {
      scheduleRestart(this)
    }
    stopForegroundCompat()
    super.onDestroy()
  }

  override fun onHeadlessJsTaskStart(taskId: Int): Unit = Unit

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    if (taskId != this.taskId) return
    this.taskId = null
    Log.i(TAG, "GatewayService: gateway task ended")
    // onDestroy schedules the restart unless the Operator paused.
    stopSelf()
  }

  private fun enterForeground(): Boolean {
    GatewayNotification.ensureChannel(this)
    val notification = GatewayNotification.current(this)
    return try {
      // Works without POST_NOTIFICATIONS; the notification is just not shown (Requirement 9.7).
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        startForeground(
          GatewayNotification.NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
        )
      } else {
        startForeground(GatewayNotification.NOTIFICATION_ID, notification)
      }
      true
    } catch (e: RuntimeException) {
      // ForegroundServiceStartNotAllowedException (API 31+) and similar refusals.
      Log.w(TAG, "GatewayService: startForeground refused (${e.javaClass.simpleName})")
      false
    }
  }

  private fun stopForegroundCompat() {
    stopForeground(STOP_FOREGROUND_REMOVE) // minSdk 26
  }

  /** Moves stored `pending_inbox` rows into the queue before the loop attaches (design InboxQueue). */
  private fun loadPendingInbox() {
    val appContext = applicationContext
    Thread({
      try {
        InboxQueue.get(appContext).loadPending()
      } catch (e: RuntimeException) {
        Log.w(TAG, "GatewayService: pending inbox unreadable (${e.javaClass.simpleName})")
      }
    }, "lazarus-inbox-load").start()
  }

  private fun startGatewayTask() {
    UiThreadUtil.assertOnUiThread()
    val host = (application as? ReactApplication)?.reactHost
    if (host == null) {
      Log.w(TAG, "GatewayService: no ReactHost")
      return
    }
    taskStarting = true
    val context = host.currentReactContext
    if (context != null) {
      runTask(context)
      return
    }
    host.addReactInstanceEventListener(
      object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          host.removeReactInstanceEventListener(this)
          runTask(context)
        }
      },
    )
    host.start()
  }

  private fun runTask(context: ReactContext) {
    UiThreadUtil.runOnUiThread {
      taskStarting = false
      if (stopRequested || !isRunning) return@runOnUiThread
      val tasks = HeadlessJsTaskContext.getInstance(context)
      tasks.addTaskEventListener(this)
      val config = HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), 0, true)
      taskId = try {
        tasks.startTask(config)
      } catch (e: IllegalStateException) {
        Log.w(TAG, "GatewayService: task start failed (${e.javaClass.simpleName})")
        null
      }
    }
  }

  companion object {
    const val TASK_KEY = "LazarusGateway"
    private const val TAG = "Lazarus"
    private const val REQ_RESTART = 2001
    private const val WAKE_LOCK_TAG = "Lazarus:gateway-processing"

    /** True between a successful `startForeground` and `onDestroy`. Read by receivers and modules. */
    @Volatile
    var isRunning: Boolean = false
      private set

    /** Called on the main thread when [isRunning] changes; GatewayModule emits `onServiceStatus`. */
    @Volatile var onRunningChanged: ((Boolean) -> Unit)? = null

    private val wakeLockGuard = Any()
    private var processingWakeLock: PowerManager.WakeLock? = null

    private fun setRunning(running: Boolean) {
      if (isRunning == running) return
      isRunning = running
      onRunningChanged?.invoke(running)
    }

    /** `startForegroundService`; returns false when Android refuses (Requirement 9.9 path). */
    fun start(context: Context): Boolean =
      try {
        context.startForegroundService(Intent(context, GatewayService::class.java))
        true
      } catch (e: IllegalStateException) {
        // Includes ForegroundServiceStartNotAllowedException (API 31+).
        Log.w(TAG, "GatewayService: start refused (${e.javaClass.simpleName})")
        false
      } catch (e: SecurityException) {
        Log.w(TAG, "GatewayService: start refused (${e.javaClass.simpleName})")
        false
      }

    /** Stops the service. Callers that pause must persist `paused=1` first so no restart is scheduled. */
    fun stop(context: Context) {
      cancelRestart(context)
      context.stopService(Intent(context, GatewayService::class.java))
    }

    /** `'running' | 'stopped' | 'paused'` for `getServiceStatus()`. */
    fun status(context: Context): String =
      GatewayLifecycle.serviceStatus(isRunning, readPausedOrNull(context) == true)

    /** Updates the notification text; re-posts at once while running (Requirement 9.2). */
    fun updateNotification(context: Context, stateWord: String, repliedToday: Int) {
      GatewayNotification.setState(stateWord, repliedToday)
      if (isRunning) GatewayNotification.post(context)
    }

    /** Partial wake lock while one message is processed; timed so a lost release cannot leak. */
    @SuppressLint("WakelockTimeout")
    fun acquireProcessingWakeLock(context: Context) {
      synchronized(wakeLockGuard) {
        val lock = processingWakeLock ?: run {
          val pm = context.applicationContext.getSystemService(PowerManager::class.java) ?: return
          pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply { setReferenceCounted(false) }
            .also { processingWakeLock = it }
        }
        lock.acquire(GatewayLifecycle.PROCESSING_WAKE_LOCK_MAX_MS)
      }
    }

    fun releaseProcessingWakeLock() {
      synchronized(wakeLockGuard) {
        processingWakeLock?.let { if (it.isHeld) it.release() }
      }
    }

    /** Paused flag, or null when the store cannot be read. */
    fun readPausedOrNull(context: Context): Boolean? =
      try {
        LazarusDb.get(context).readPaused()
      } catch (e: RuntimeException) {
        Log.w(TAG, "GatewayService: paused flag unreadable (${e.javaClass.simpleName})")
        null
      }

    /** Restart alarm 5 s from now (Requirement 9.4); exact only when the OS allows it. */
    fun scheduleRestart(context: Context) {
      val alarms = context.getSystemService(AlarmManager::class.java) ?: return
      val at = SystemClock.elapsedRealtime() + GatewayLifecycle.RESTART_DELAY_MS
      val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
      val pending = restartIntent(context)
      try {
        when (GatewayLifecycle.alarmMode(Build.VERSION.SDK_INT, canExact)) {
          GatewayLifecycle.AlarmMode.EXACT ->
            alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending)
          GatewayLifecycle.AlarmMode.INEXACT ->
            alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending)
        }
      } catch (e: SecurityException) {
        alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending)
      }
    }

    fun cancelRestart(context: Context) {
      context.getSystemService(AlarmManager::class.java)?.cancel(restartIntent(context))
    }

    private fun restartIntent(context: Context): PendingIntent {
      val intent = Intent(context, RestartReceiver::class.java).setAction(RestartReceiver.ACTION_RESTART)
      return PendingIntent.getBroadcast(
        context, REQ_RESTART, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    }
  }
}
