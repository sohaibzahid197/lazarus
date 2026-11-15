package dev.lazarus.necromancer.store

import android.database.Cursor
import android.database.sqlite.SQLiteCursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteProgram

/** [SqlConn] over an open `SQLiteDatabase` (for example the one passed to `onUpgrade`). */
class AndroidSqlConn(private val db: SQLiteDatabase) : SqlConn {
  override fun exec(sql: String, args: List<Any?>) {
    if (args.isEmpty()) {
      db.execSQL(sql)
    } else {
      args.forEach(::checkArg)
      db.execSQL(sql, args.toTypedArray())
    }
  }

  override fun <T> query(sql: String, args: List<Any?>, map: (SqlRow) -> T): List<T> {
    args.forEach(::checkArg)
    // A factory binds typed args; rawQuery would bind every arg as a string.
    val factory =
      SQLiteDatabase.CursorFactory { _, driver, editTable, program ->
        bindAll(program, args)
        SQLiteCursor(driver, editTable, program)
      }
    // editTable is only used by deprecated cursor updates; "" means none.
    return db.rawQueryWithFactory(factory, sql, null, "").use { c ->
      val row = CursorRow(c)
      val out = ArrayList<T>(c.count)
      while (c.moveToNext()) out.add(map(row))
      out
    }
  }

  /**
   * Android's `SQLiteSession` treats any statement starting with "ROL" as an abort of the whole
   * Android transaction (`DatabaseUtils.STATEMENT_ABORT`), so a plain `ROLLBACK TO` would end the
   * `onUpgrade` transaction. A leading `;` makes Android classify it as an ordinary statement,
   * while SQLite skips the empty statement and runs `ROLLBACK TO`.
   */
  override fun <T> savepoint(name: String, block: () -> T): T =
    runInSavepoint(name, { db.execSQL(it) }, { ";ROLLBACK TO $it" }, block)

  private fun checkArg(arg: Any?) {
    if (arg != null && arg !is String && arg !is Long && arg !is Int && arg !is Double) throw unsupportedArg(arg)
  }

  private fun bindAll(program: SQLiteProgram, args: List<Any?>) {
    args.forEachIndexed { i, arg ->
      val index = i + 1
      when (arg) {
        null -> program.bindNull(index)
        is String -> program.bindString(index, arg)
        is Long -> program.bindLong(index, arg)
        is Int -> program.bindLong(index, arg.toLong())
        is Double -> program.bindDouble(index, arg)
        else -> throw unsupportedArg(arg)
      }
    }
  }

  private class CursorRow(private val c: Cursor) : SqlRow {
    override fun isNull(index: Int): Boolean = c.isNull(index)

    override fun getLong(index: Int): Long = c.getLong(index)

    override fun getString(index: Int): String? = c.getString(index)
  }
}
