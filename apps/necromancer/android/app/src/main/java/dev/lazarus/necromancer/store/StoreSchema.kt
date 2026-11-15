package dev.lazarus.necromancer.store

/**
 * `lazarus.db` schema (necromancer-sms-gateway design, "SQLite schema"; sms-reminders design,
 * "SQLite schema version 2"). Plain Kotlin so the DDL can be checked on the JVM.
 * Version 1 tables are [CREATE_STATEMENTS]; version 2 adds [REMINDER_DDL] via [ReminderMigration].
 */
object StoreSchema {
  const val DB_NAME = "lazarus.db"
  const val VERSION = 2

  /**
   * Version 2: the `reminder` table and its due index. Idempotent (`IF NOT EXISTS`) so a failed
   * upgrade can be retried on a later open.
   *
   * `length(text)` counts code points, not UTF-16 code units, so the text `CHECK` is a looser
   * bound: every text of at most 140 UTF-16 code units passes. The exact 140 UTF-16 code unit
   * rule is enforced by `StoreWire` (Kotlin `String.length`) and by the brain's `decodeReminders`.
   */
  val REMINDER_DDL: List<String> =
    listOf(
      "CREATE TABLE IF NOT EXISTS reminder (" +
        "id TEXT PRIMARY KEY, " +
        "number TEXT NOT NULL, " +
        "slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5), " +
        "due_at INTEGER NOT NULL, " +
        "text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 140), " +
        "language TEXT NOT NULL CHECK (language IN ('en', 'ur', 'roman-ur')), " +
        "created_at INTEGER NOT NULL, " +
        "handed_at INTEGER, " +
        "UNIQUE (number, slot))",
      "CREATE INDEX IF NOT EXISTS reminder_due ON reminder(handed_at, due_at)",
    )

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
