package dev.lazarus.necromancer.store

/** One parameterized SQL write. Args are bound, never interpolated. */
data class SqlOp(val sql: String, val args: List<Any>)

/** Pure SQL builders for the NativeStore writes. */
object StoreSql {
  const val SELECT_STOP_LIST = "SELECT number FROM stop_list ORDER BY number"
  const val SELECT_ALLOWLIST = "SELECT number FROM allowlist ORDER BY number"
  const val SELECT_RATE = "SELECT number, at FROM rate_record ORDER BY number, at"
  const val SELECT_SLOWDOWN = "SELECT number, at FROM slowdown ORDER BY number"
  const val SELECT_COUNTERS = "SELECT json FROM counters WHERE id = 1"
  const val SELECT_KV = "SELECT value FROM kv WHERE key = ?"
  const val SELECT_ACTIVITY =
    "SELECT received_at, who, command, outcome FROM activity ORDER BY received_at DESC, id DESC LIMIT " +
      StoreSchema.ACTIVITY_LIMIT
  const val DELETE_ALL_ACTIVITY = "DELETE FROM activity"
  const val SELECT_PENDING_STOPS =
    "SELECT rowid, sender, marker, received_at FROM pending_stop ORDER BY received_at, rowid"
  const val DELETE_PENDING_STOP = "DELETE FROM pending_stop WHERE rowid = ?"

  /** SQL for one change; `rate-record` also prunes records older than 24 h (design "SQLite schema"). */
  fun forChange(change: StoreChange): List<SqlOp> =
    when (change) {
      is StoreChange.StopAdd -> listOf(SqlOp("INSERT OR IGNORE INTO stop_list(number) VALUES (?)", listOf(change.number)))
      is StoreChange.StopRemove -> listOf(SqlOp("DELETE FROM stop_list WHERE number = ?", listOf(change.number)))
      is StoreChange.AllowAdd -> listOf(SqlOp("INSERT OR IGNORE INTO allowlist(number) VALUES (?)", listOf(change.number)))
      is StoreChange.AllowRemove -> listOf(SqlOp("DELETE FROM allowlist WHERE number = ?", listOf(change.number)))
      is StoreChange.RateRecord ->
        listOf(
          SqlOp("INSERT INTO rate_record(number, at) VALUES (?, ?)", listOf(change.number, change.at)),
          SqlOp("DELETE FROM rate_record WHERE at <= ?", listOf(change.at - StoreSchema.RATE_RETENTION_MS)),
        )
      is StoreChange.SlowdownRecord ->
        listOf(SqlOp("INSERT OR REPLACE INTO slowdown(number, at) VALUES (?, ?)", listOf(change.number, change.at)))
      is StoreChange.Counters ->
        listOf(SqlOp("INSERT OR REPLACE INTO counters(id, json) VALUES (1, ?)", listOf(change.json)))
    }

  fun forChanges(changes: List<StoreChange>): List<SqlOp> = changes.flatMap(::forChange)

  fun putKv(key: String, value: String): SqlOp =
    SqlOp("INSERT OR REPLACE INTO kv(key, value) VALUES (?, ?)", listOf(key, value))

  /** Insert plus trim to the newest 200 by `(received_at, id)` (Requirement 14.3). */
  fun appendActivity(entry: ActivityRecord): List<SqlOp> =
    listOf(
      SqlOp(
        "INSERT INTO activity(received_at, who, command, outcome) VALUES (?, ?, ?, ?)",
        listOf(entry.receivedAt, entry.who, entry.command, entry.outcome),
      ),
      SqlOp(
        "DELETE FROM activity WHERE id NOT IN " +
          "(SELECT id FROM activity ORDER BY received_at DESC, id DESC LIMIT ${StoreSchema.ACTIVITY_LIMIT})",
        emptyList(),
      ),
    )

  /** The 3 Pending_Stop_Record columns; no body (Requirements 9.13, 14.13). */
  fun insertPendingStop(sender: String, receivedAt: Long): SqlOp =
    SqlOp(
      "INSERT INTO pending_stop(sender, marker, received_at) VALUES (?, ?, ?)",
      listOf(sender, StoreSchema.STOP_MARKER, receivedAt),
    )
}
