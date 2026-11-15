package dev.lazarus.necromancer.stop

import android.content.Context
import android.util.Log

/**
 * Paused-path fallback Stop_Keyword_Check (Requirement 9.13, 17.7). Runs only when Android
 * refuses the Paused_Path_Task. Loads the asset once (lazy, thread-safe). If the asset is
 * missing, unreadable or not `v == 1`, [matches] returns false and one line is logged, so a
 * broken build can never create a false opt-out.
 *
 * Pure Kotlin: the asset text comes from [readAsset] and log lines go to [log], so JVM tests
 * can construct it directly. [fromAssets] is the thin Android wrapper.
 */
class StopKeywordCheck(
    private val readAsset: () -> String,
    private val log: (String) -> Unit,
) {
    private val asset: StopAliasAsset? by lazy(LazyThreadSafetyMode.SYNCHRONIZED) { load() }

    private fun load(): StopAliasAsset? {
        val parsed = try {
            StopAliasAsset.parse(readAsset())
        } catch (e: Exception) {
            null
        }
        if (parsed == null) log(UNREADABLE_LINE)
        return parsed
    }

    /** True when the body's first word is a Stop_Alias_List entry; false when the asset is unusable. */
    fun matches(body: String): Boolean = asset?.matches(body) ?: false

    /** The STOP_Marker from the asset, or null when the asset is unusable. */
    fun stopMarker(): String? = asset?.stopMarker

    companion object {
        const val ASSET_NAME = "stop_aliases.json"
        const val UNREADABLE_LINE = "StopKeywordCheck: asset unreadable"
        private const val TAG = "Lazarus"

        @Volatile
        private var instance: StopKeywordCheck? = null

        /** Process-wide instance reading `assets/stop_aliases.json`; logs to logcat. */
        fun fromAssets(context: Context): StopKeywordCheck =
            instance ?: synchronized(this) {
                instance ?: create(context.applicationContext).also { instance = it }
            }

        private fun create(app: Context) = StopKeywordCheck(
            readAsset = { app.assets.open(ASSET_NAME).use { it.readBytes().toString(Charsets.UTF_8) } },
            log = { Log.w(TAG, it) },
        )
    }
}
