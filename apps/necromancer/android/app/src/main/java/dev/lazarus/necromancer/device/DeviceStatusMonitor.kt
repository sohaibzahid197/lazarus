package dev.lazarus.necromancer.device

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.telephony.PhoneStateListener
import android.telephony.ServiceState
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Reads the Device_Status (Requirements 11.10, 12.6, 13.11, 13.14) and calls [onChange]
 * when it differs from the last reported one.
 *
 * Cellular service comes from a service-state listener, which needs no READ_PHONE_STATE
 * permission; the last reported state is cached. Listeners and the airplane-mode receiver
 * are registered on the main looper. Callers re-check on app resume through [recheck].
 */
class DeviceStatusMonitor(
  context: Context,
  private val onChange: (DeviceStatus) -> Unit,
) {
  private val context: Context = context.applicationContext
  private val mainHandler = Handler(Looper.getMainLooper())
  private val lock = Any()

  @Volatile private var inService: Boolean = DeviceStatusDiff.INITIAL_IN_SERVICE
  private var lastReported: DeviceStatus? = null
  private var started = false

  private var telephonyCallback: Any? = null
  private var phoneStateListener: PhoneStateListener? = null

  private val airplaneReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      recheck()
    }
  }

  /** Registers the listeners on the main looper. Safe to call more than once. */
  fun start() {
    mainHandler.post {
      synchronized(lock) {
        if (started) return@post
        started = true
      }
      registerAirplaneReceiver()
      registerServiceListener()
      recheck()
    }
  }

  /** Unregisters everything. Safe to call more than once. */
  fun stop() {
    mainHandler.post {
      synchronized(lock) {
        if (!started) return@post
        started = false
      }
      try {
        context.unregisterReceiver(airplaneReceiver)
      } catch (_: IllegalArgumentException) {
        // Never registered.
      }
      unregisterServiceListener()
    }
  }

  /** Reads the status now, without emitting. */
  fun current(): DeviceStatus = DeviceStatus(
    smsPermission = granted(Manifest.permission.RECEIVE_SMS) && granted(Manifest.permission.SEND_SMS),
    notificationPermission = notificationsAllowed(),
    batteryOptimisationIgnored = batteryOptimisationIgnored(),
    inService = inService,
    airplaneMode = airplaneModeOn(),
  )

  /** Reads the status and calls [onChange] only when it differs from the last report. */
  fun recheck(): DeviceStatus {
    val next = current()
    val emit = synchronized(lock) {
      val changed = DeviceStatusDiff.shouldEmit(lastReported, next)
      if (changed) lastReported = next
      changed
    }
    if (emit) onChange(next)
    return next
  }

  private fun onServiceState(state: ServiceState) {
    inService = DeviceStatusDiff.inServiceFrom(state.state)
    recheck()
  }

  private fun granted(permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

  private fun notificationsAllowed(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      granted(Manifest.permission.POST_NOTIFICATIONS)
    } else {
      NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

  private fun batteryOptimisationIgnored(): Boolean {
    val power = context.getSystemService(PowerManager::class.java) ?: return false
    return power.isIgnoringBatteryOptimizations(context.packageName)
  }

  private fun airplaneModeOn(): Boolean =
    Settings.Global.getInt(context.contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) != 0

  private fun registerAirplaneReceiver() {
    ContextCompat.registerReceiver(
      context,
      airplaneReceiver,
      IntentFilter(Intent.ACTION_AIRPLANE_MODE_CHANGED),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
  }

  private fun telephony(): TelephonyManager? = context.getSystemService(TelephonyManager::class.java)

  private fun registerServiceListener() {
    val tm = telephony() ?: return
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val callback = ServiceStateCallback(::onServiceState)
        tm.registerTelephonyCallback(ContextCompat.getMainExecutor(context), callback)
        telephonyCallback = callback
      } else {
        val listener = LegacyServiceStateListener(::onServiceState)
        @Suppress("DEPRECATION")
        tm.listen(listener, PhoneStateListener.LISTEN_SERVICE_STATE)
        phoneStateListener = listener
      }
    } catch (_: SecurityException) {
      // Keep the cached value; the heartbeat still reads every other field.
    }
  }

  private fun unregisterServiceListener() {
    val tm = telephony() ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (telephonyCallback as? TelephonyCallback)?.let { tm.unregisterTelephonyCallback(it) }
    } else {
      @Suppress("DEPRECATION")
      phoneStateListener?.let { tm.listen(it, PhoneStateListener.LISTEN_NONE) }
    }
    telephonyCallback = null
    phoneStateListener = null
  }
}

@androidx.annotation.RequiresApi(Build.VERSION_CODES.S)
private class ServiceStateCallback(
  private val onState: (ServiceState) -> Unit,
) : TelephonyCallback(), TelephonyCallback.ServiceStateListener {
  override fun onServiceStateChanged(serviceState: ServiceState) = onState(serviceState)
}

/** Created on the main thread, so its callbacks run on the main looper. */
@Suppress("DEPRECATION")
private class LegacyServiceStateListener(
  private val onState: (ServiceState) -> Unit,
) : PhoneStateListener() {
  @Deprecated("Deprecated in Java")
  override fun onServiceStateChanged(serviceState: ServiceState?) {
    serviceState?.let(onState)
  }
}
