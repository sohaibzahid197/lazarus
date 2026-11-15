package dev.lazarus.necromancer.store

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * The single native store `lazarus.db` (WAL). Every write runs in one transaction.
 * Shared by [StoreModule], the receivers and the send path through [get].
 * Methods throw on SQLite errors; callers turn that into a rejected promise or a log line.
 */
class LazarusDb private constructor(context: Context) :
  SQLiteOpenHelper(context, StoreSchema.DB_NAME, null, StoreSchema.VERSION) {

  init {
    setWriteAheadLoggingEnabled(true)
  }

  override fun onCreate(db: SQLiteDatabase) {
    StoreSchema.CREATE_STATEMENTS.forEach(db::execSQL)
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    // Version 1 is the only schema.
  }

  // ---- reads ----

  /** Throws when the Stop_List cannot be read, so `loadState` rejects (Requirement 3.11). */
  fun readStopList(): List<String> = readStrings(StoreSql.SELECT_STOP_LIST)

  fun isStopped(number: String): Boolean = readStopList().contains(number)

  fun loadSnapshot(): StoredSnapshot {
    val stopList = readStopList()
    val allowlist = runCatching { readStrings(StoreSql.SELECT_ALLOWLIST) }.getOrNull()
    return StoredSnapshot(
      stopList = stopList,
      allowlist = allowlist,
      rate = readRate(),
      slowDown = readSlowDown(),
      countersJson = readCounters(),
      settings = readKv(StoreSchema.KV_SETTINGS),
      paused = readPaused(),
    )
  }

  fun readPaused(): Boolean = readKv(StoreSchema.KV_PAUSED) == "1"

  /** Every Pending_Stop_Record; rows are deleted only by [applyPendingStop]. */
  fun readPendingStops(): List<PendingStopRow> =
    readableDatabase.rawQuery(StoreSql.SELECT_PENDING_STOPS, null).use { c ->
      val out = ArrayList<PendingStopRow>(c.count)
      while (c.moveToNext()) out.add(PendingStopRow(c.getLong(0), c.getString(1), c.getString(2), c.getLong(3)))
      out
    }

  fun readActivity(): List<ActivityRecord> =
    readableDatabase.rawQuery(StoreSql.SELECT_ACTIVITY, null).use { c ->
      val out = ArrayList<ActivityRecord>(c.count)
      while (c.moveToNext()) out.add(ActivityRecord(c.getLong(0), c.getString(1), c.getString(2), c.getString(3)))
      out
    }

  fun readSetupMarks(): Map<String, Boolean> =
    StoreSchema.SETUP_STEPS.associateWith { readKv(StoreWire.setupKey(it)) == "1" }

  // ---- writes ----

  fun commit(changes: List<StoreChange>) = inTransaction { db -> run(db, StoreSql.forChanges(changes)) }

  /** Operator pause flag (Requirement 9.5, 9.8); read by the service, receivers and `loadState`. */
  fun setPaused(paused: Boolean) =
    inTransaction { db -> run(db, listOf(StoreSql.putKv(StoreSchema.KV_PAUSED, if (paused) "1" else "0"))) }
  fun saveSettings(raw: String) = inTransaction { db -> run(db, listOf(StoreSql.putKv(StoreSchema.KV_SETTINGS, raw))) }

  fun setSetupMark(step: String, done: Boolean) =
    inTransaction { db -> run(db, listOf(StoreSql.putKv(StoreWire.setupKey(step), if (done) "1" else "0"))) }

  fun appendActivity(entry: ActivityRecord) = inTransaction { db -> run(db, StoreSql.appendActivity(entry)) }

  fun clearActivity() = inTransaction { db -> db.execSQL(StoreSql.DELETE_ALL_ACTIVITY) }

  /** Writes one Pending_Stop_Record (3 columns, no body). Used by `savePendingStop` and `PendingStopStore`. */
  fun insertPendingStop(sender: String, receivedAt: Long) =
    inTransaction { db -> run(db, listOf(StoreSql.insertPendingStop(sender, receivedAt))) }

  /**
   * One transaction: delete pending_stop row [rowId], apply [changes], append [entry].
   * Returns false (and rolls back) when the row does not exist. Throws on SQLite errors,
   * which also rolls back, so the row stays for the next start (Requirement 9.16).
   */
  fun applyPendingStop(rowId: Long, changes: List<StoreChange>, entry: ActivityRecord): Boolean {
    val db = writableDatabase
    db.beginTransaction()
    try {
      val deleted =
        db.compileStatement(StoreSql.DELETE_PENDING_STOP).use { st ->
          st.bindLong(1, rowId)
          st.executeUpdateDelete()
        }
      if (deleted != 1) return false
      run(db, StoreSql.forChanges(changes))
      run(db, StoreSql.appendActivity(entry))
      db.setTransactionSuccessful()
      return true
    } finally {
      db.endTransaction()
    }
  }

  // ---- helpers ----

  private inline fun inTransaction(block: (SQLiteDatabase) -> Unit) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      block(db)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  private fun run(db: SQLiteDatabase, ops: List<SqlOp>) {
    for (op in ops) {
      if (op.args.isEmpty()) db.execSQL(op.sql) else db.execSQL(op.sql, op.args.toTypedArray())
    }
  }

  private fun readStrings(sql: String): List<String> =
    readableDatabase.rawQuery(sql, null).use { c ->
      val out = ArrayList<String>(c.count)
      while (c.moveToNext()) out.add(c.getString(0))
      out
    }

  private fun readRate(): Map<String, List<Long>> =
    readableDatabase.rawQuery(StoreSql.SELECT_RATE, null).use { c ->
      val out = LinkedHashMap<String, MutableList<Long>>()
      while (c.moveToNext()) out.getOrPut(c.getString(0)) { ArrayList() }.add(c.getLong(1))
      out
    }

  private fun readSlowDown(): Map<String, Long> =
    readableDatabase.rawQuery(StoreSql.SELECT_SLOWDOWN, null).use { c ->
      val out = LinkedHashMap<String, Long>()
      while (c.moveToNext()) out[c.getString(0)] = c.getLong(1)
      out
    }

  private fun readCounters(): String? =
    readableDatabase.rawQuery(StoreSql.SELECT_COUNTERS, null).use { c -> if (c.moveToFirst()) c.getString(0) else null }

  private fun readKv(key: String): String? =
    readableDatabase.rawQuery(StoreSql.SELECT_KV, arrayOf(key)).use { c -> if (c.moveToFirst()) c.getString(0) else null }

  companion object {
    @Volatile private var instance: LazarusDb? = null

    fun get(context: Context): LazarusDb =
      instance ?: synchronized(this) {
        instance ?: LazarusDb(context.applicationContext).also { instance = it }
      }
  }
}
