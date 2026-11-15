@file:Suppress("DEPRECATION") // security-crypto 1.1.0 is deprecated; ApiKeyStore lets us swap it later.

package dev.lazarus.necromancer.keystore

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.ProviderException

/**
 * [ApiKeyStore] on EncryptedSharedPreferences in the app's private storage.
 * The file and the Keystore alias are excluded from backup by data_extraction_rules.xml (16.22).
 * Log lines name only the exception class, never the key or an exception message (16.14).
 */
class EncryptedApiKeyStore(context: Context) : ApiKeyStore {
  private val appContext: Context = context.applicationContext
  private var prefs: SharedPreferences? = null
  private var failed = false

  @Synchronized
  override fun read(): KeyRead =
    try {
      val key = open().getString(ENTRY, null)
      if (key.isNullOrEmpty()) KeyRead.Absent else KeyRead.Present(key)
    } catch (e: Exception) {
      if (!isStoreFailure(e)) throw e
      markFailed("read", e)
      KeyRead.Unreadable
    }

  @Synchronized
  override fun write(key: String) {
    if (failed) reset()
    try {
      putKey(key)
    } catch (e: Exception) {
      if (!isStoreFailure(e)) throw e
      markFailed("write", e)
      reset()
      putKey(key)
    }
  }

  @Synchronized
  override fun delete() {
    try {
      if (!open().edit().remove(ENTRY).commit()) throw IOException("commit failed")
    } catch (e: Exception) {
      if (!isStoreFailure(e)) throw e
      markFailed("delete", e)
      reset()
    }
  }

  private fun putKey(key: String) {
    if (!open().edit().putString(ENTRY, key).commit()) throw IOException("commit failed")
  }

  private fun open(): SharedPreferences =
    prefs ?: EncryptedSharedPreferences.create(
      appContext,
      FILE_NAME,
      MasterKey.Builder(appContext, MASTER_KEY_ALIAS)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build(),
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    ).also { prefs = it }

  /** Deletes the prefs file and the Keystore alias; the next [open] recreates both (16.21). */
  private fun reset() {
    prefs = null
    appContext.deleteSharedPreferences(FILE_NAME)
    try {
      KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }.deleteEntry(MASTER_KEY_ALIAS)
    } catch (e: Exception) {
      if (!isStoreFailure(e)) throw e
      Log.w(TAG, "ApiKeyStore: alias delete failed (${e.javaClass.simpleName})")
    }
    failed = false
  }

  private fun markFailed(op: String, e: Exception) {
    prefs = null
    failed = true
    Log.w(TAG, "ApiKeyStore: $op failed (${e.javaClass.simpleName})")
  }

  private fun isStoreFailure(e: Exception): Boolean =
    e is GeneralSecurityException ||
      e is IOException ||
      e is SecurityException ||
      e is ProviderException

  companion object {
    const val FILE_NAME = "lazarus_key"
    const val MASTER_KEY_ALIAS = "_lazarus_key_master_"
    private const val ENTRY = "gemini_api_key"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val TAG = "Lazarus"
  }
}
