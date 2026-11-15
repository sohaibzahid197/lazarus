package dev.lazarus.necromancer.store

/** One result row. Column indexes start at 0. */
interface SqlRow {
  fun isNull(index: Int): Boolean

  fun getLong(index: Int): Long

  fun getString(index: Int): String?
}

/**
 * The few SQL operations the schema migration and the reminder table need.
 * [AndroidSqlConn] wraps `SQLiteDatabase`; JVM tests use a JDBC implementation with real SQLite,
 * so savepoint, `UNIQUE` and `CHECK` behaviour is tested without a device (Requirement 14.8).
 *
 * Args are bound, never interpolated. Supported arg types: `null`, [String], [Long], [Int], [Double].
 */
interface SqlConn {
  /** Runs one statement that returns no rows. */
  fun exec(sql: String, args: List<Any?> = emptyList())

  /** Runs one query and maps every row with [map], in result order. */
  fun <T> query(sql: String, args: List<Any?> = emptyList(), map: (SqlRow) -> T): List<T>

  /**
   * Runs [block] inside `SAVEPOINT name`. On success the savepoint is released.
   * On any exception it runs `ROLLBACK TO name; RELEASE name` and rethrows,
   * so only the work of [block] is undone. [name] must be a plain SQL identifier.
   */
  fun <T> savepoint(name: String, block: () -> T): T
}

private val SAVEPOINT_NAME = Regex("[A-Za-z_][A-Za-z0-9_]*")

/**
 * Shared savepoint logic for every [SqlConn]. [rollbackSql] builds the `ROLLBACK TO` statement,
 * because Android needs a different spelling (see [AndroidSqlConn]).
 */
internal inline fun <T> runInSavepoint(
  name: String,
  exec: (String) -> Unit,
  rollbackSql: (String) -> String,
  block: () -> T,
): T {
  require(SAVEPOINT_NAME.matches(name)) { "invalid savepoint name" }
  exec("SAVEPOINT $name")
  try {
    val result = block()
    exec("RELEASE $name")
    return result
  } catch (e: Throwable) {
    try {
      exec(rollbackSql(name))
      exec("RELEASE $name")
    } catch (cleanup: Throwable) {
      e.addSuppressed(cleanup)
    }
    throw e
  }
}

/** Error text for an unsupported bind arg. Names only the type, never the value. */
internal fun unsupportedArg(arg: Any): IllegalArgumentException =
  IllegalArgumentException("unsupported SQL arg type ${arg.javaClass.simpleName}")
