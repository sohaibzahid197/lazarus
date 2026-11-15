package dev.lazarus.necromancer.store

/**
 * Schema version 1 → 2: adds the `reminder` table (Requirements 12.1–12.4).
 *
 * Runs [StoreSchema.REMINDER_DDL] inside `SAVEPOINT v2` through [SqlConn.savepoint], which on any
 * exception runs `ROLLBACK TO v2; RELEASE v2` (with the Android-safe spelling in
 * [AndroidSqlConn]). Only the migration's own work is undone, so version 1 rows are untouched and
 * an enclosing `onUpgrade` transaction stays open. The caller treats `false` as an unreadable
 * Reminder_Store and retries on a later open; the DDL is idempotent.
 */
object ReminderMigration {
  const val SAVEPOINT = "v2"

  /**
   * Returns `true` when the table and index exist afterwards, `false` on any failure.
   * [log] receives only the exception class, never SQL args, numbers or reminder text.
   */
  fun migrate(conn: SqlConn, log: (String) -> Unit = {}): Boolean =
    try {
      conn.savepoint(SAVEPOINT) { StoreSchema.REMINDER_DDL.forEach { conn.exec(it) } }
      true
    } catch (e: Exception) {
      log("ReminderMigration: failed (${e.javaClass.simpleName})")
      false
    }
}
