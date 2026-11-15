package dev.lazarus.necromancer.stop

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log
import dev.lazarus.necromancer.log.LogMask
import dev.lazarus.necromancer.store.LazarusDb

/**
 * Writes one row of the `pending_stop` table. Takes exactly the 3 Pending_Stop_Record fields
 * and no body, so a body can never reach storage (Requirement 9.13, 14.13).
 * Implementations throw on failure.
 */
fun interface PendingStopSink {
    fun insertPendingStop(sender: String, marker: String, receivedAt: Long)
}

/**
 * [PendingStopSink] over the `pending_stop` table owned by `LazarusDb` (any [SQLiteOpenHelper]
 * whose schema has that table). Issues only the INSERT.
 */
class SqlitePendingStopSink(private val db: SQLiteOpenHelper) : PendingStopSink {
    override fun insertPendingStop(sender: String, marker: String, receivedAt: Long) {
        val values = ContentValues(3).apply {
            put("sender", sender)
            put("marker", marker)
            put("received_at", receivedAt)
        }
        db.writableDatabase.insertOrThrow("pending_stop", null, values)
    }
}

/**
 * Stores a Pending_Stop_Record for a STOP received while Android refused the Paused_Path_Task.
 * Writes exactly one log line per call, containing only [LogMask.tail3] of the sender
 * (Requirement 14.14). The marker comes from the stop alias asset, never a Kotlin literal.
 */
class PendingStopStore(
    private val sink: PendingStopSink,
    private val check: StopKeywordCheck,
    private val log: (String) -> Unit,
) {
    /** Returns true when the row was written. */
    fun insert(sender: String, receivedAt: Long): Boolean {
        val from = LogMask.tail3(sender)
        val marker = check.stopMarker()
        if (marker == null) {
            log("PendingStop: store failed (asset unreadable, from $from)")
            return false
        }
        return try {
            sink.insertPendingStop(sender, marker, receivedAt)
            log("PendingStop: stored (from $from)")
            true
        } catch (e: Exception) {
            log("PendingStop: store failed (${e.javaClass.simpleName}, from $from)")
            false
        }
    }

    companion object {
        private const val TAG = "Lazarus"

        /** Android wiring: `pending_stop` in `LazarusDb`, marker from the asset, logcat output. */
        fun fromContext(context: Context): PendingStopStore = PendingStopStore(
            sink = SqlitePendingStopSink(LazarusDb.get(context)),
            check = StopKeywordCheck.fromAssets(context),
            log = { Log.w(TAG, it) },
        )
    }
}
