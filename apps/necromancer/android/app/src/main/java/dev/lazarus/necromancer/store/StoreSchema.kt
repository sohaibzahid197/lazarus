package dev.lazarus.necromancer.store

/**
 * `lazarus.db` schema version 1 (necromancer-sms-gateway design, "SQLite schema").
 * Plain Kotlin so the DDL can be checked on the JVM.
 */
object StoreSchema {
  const val DB_NAME = "lazarus.db"
  const val VERSION = 1

  /** The only marker value `pending_stop.marker` accepts (brain `STOP_MARKER`). */
  const val STOP_MARKER = "STOP"

  /** Activity_Log size limit (Requirement 14.3). */
  const val ACTIVITY_LIMIT = 200

  /** Rate records at or before `newAt - RATE_RETENTION_MS` are pruned (max window is 1440 min). */
  const val RATE_RETENTION_MS = 86_400_000L

  const val KV_SETTINGS = "settings"
  const val KV_PAUSED = "paused"
  const val KV_SETUP_PREFIX = "setup."

  /** Manual Setup_Step marks stored in `kv` as `setup.<step>` (Requirement 12.7). */
  val SETUP_STEPS: List<String> = listOf("autostart", "recents")

  val CREATE_STATEMENTS: List<String> =
    listOf(
      "CREATE TABLE stop_list (number TEXT PRIMARY KEY)",
      "CREATE TABLE allowlist (number TEXT PRIMARY KEY)",
      "CREATE TABLE rate_record (number TEXT NOT NULL, at INTEGER NOT NULL)",
      "CREATE INDEX rate_record_number ON rate_record(number, at)",
      "CREATE TABLE slowdown (number TEXT PRIMARY KEY, at INTEGER NOT NULL)",
      "CREATE TABLE counters (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)",
      "CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      "CREATE TABLE activity (id INTEGER PRIMARY KEY AUTOINCREMENT, received_at INTEGER NOT NULL, " +
        "who TEXT NOT NULL, command TEXT NOT NULL, outcome TEXT NOT NULL)",
      "CREATE TABLE pending_inbox (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, sender TEXT NOT NULL, " +
        "body TEXT NOT NULL, received_at INTEGER NOT NULL)",
      // Pending_Stop_Record: exactly 3 columns, no body column (Requirements 9.13, 14.13).
      "CREATE TABLE pending_stop (sender TEXT NOT NULL, " +
        "marker TEXT NOT NULL CHECK (marker = '$STOP_MARKER'), received_at INTEGER NOT NULL)",
    )
}
