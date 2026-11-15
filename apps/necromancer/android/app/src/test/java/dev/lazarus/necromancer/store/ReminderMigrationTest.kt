package dev.lazarus.necromancer.store

import java.io.File
import java.sql.SQLException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Schema version 1 → 2 upgrade and the `reminder` table, on real SQLite through [JdbcSqlConn]
 * (Requirements 12.2, 12.3, 12.4, 14.8).
 */
class ReminderMigrationTest {
  private val number = "+923001234567"
  private val otherNumber = "+923339876543"
  private val text = "take medicine"

  /** Every version 1 table with its columns, so rows can be compared before and after. */
  private val v1Tables: Map<String, List<String>> =
    linkedMapOf(
      "stop_list" to listOf("number"),
      "allowlist" to listOf("number"),
      "rate_record" to listOf("number", "at"),
      "slowdown" to listOf("number", "at"),
      "counters" to listOf("id", "json"),
      "kv" to listOf("key", "value"),
      "activity" to listOf("id", "received_at", "who", "command", "outcome"),
      "pending_inbox" to listOf("id", "seq", "sender", "body", "received_at"),
      "pending_stop" to listOf("sender", "marker", "received_at"),
    )

  private val reminderColumns =
    listOf("id", "number", "slot", "due_at", "text", "language", "created_at", "handed_at")

  // ---- helpers ----

  /** A version 1 database (no `reminder` table) with at least one row in every table. */
  private fun seedV1(c: SqlConn) {
    StoreSchema.CREATE_STATEMENTS.forEach { c.exec(it) }
    c.exec("INSERT INTO stop_list(number) VALUES (?)", listOf(number))
    c.exec("INSERT INTO allowlist(number) VALUES (?)", listOf(otherNumber))
    c.exec("INSERT INTO rate_record(number, at) VALUES (?, ?)", listOf(number, 1_000L))
    c.exec("INSERT INTO rate_record(number, at) VALUES (?, ?)", listOf(number, 2_000L))
    c.exec("INSERT INTO slowdown(number, at) VALUES (?, ?)", listOf(otherNumber, 3_000L))
    c.exec("INSERT INTO counters(id, json) VALUES (1, ?)", listOf("{\"received\":4}"))
    c.exec("INSERT INTO kv(key, value) VALUES (?, ?)", listOf(StoreSchema.KV_PAUSED, "false"))
    c.exec("INSERT INTO kv(key, value) VALUES (?, ?)", listOf(StoreSchema.KV_SETTINGS, "{}"))
    c.exec(
      "INSERT INTO activity(received_at, who, command, outcome) VALUES (?, ?, ?, ?)",
      listOf(5_000L, "••••••••••567", "HELP", "replied"),
    )
    c.exec(
      "INSERT INTO pending_inbox(id, seq, sender, body, received_at) VALUES (?, ?, ?, ?, ?)",
      listOf("m1", 1L, otherNumber, "hello", 6_000L),
    )
    c.exec(
      "INSERT INTO pending_stop(sender, marker, received_at) VALUES (?, ?, ?)",
      listOf(number, StoreSchema.STOP_MARKER, 7_000L),
    )
    c.exec("PRAGMA user_version = 1")
  }

  /** Every row of [table], each as quoted column values, in a stable order. */
  private fun rows(c: SqlConn, table: String, columns: List<String>): List<String> {
    val cols = columns.joinToString(" || '|' || ") { "quote($it)" }
    val order = columns.joinToString(", ")
    return c.query("SELECT $cols FROM $table ORDER BY $order") { it.getString(0)!! }
  }

  private fun v1Dump(c: SqlConn): Map<String, List<String>> = v1Tables.mapValues { (t, cols) -> rows(c, t, cols) }

  /** The full schema text, so "unchanged" covers tables and indexes too. */
  private fun schema(c: SqlConn): List<String> =
    c.query("SELECT type || ':' || name || ':' || coalesce(sql, '') FROM sqlite_master ORDER BY type, name") {
      it.getString(0)!!
    }

  private fun objectNames(c: SqlConn, type: String): Set<String> =
    c.query("SELECT name FROM sqlite_master WHERE type = ?", listOf(type)) { it.getString(0)!! }.toSet()

  private fun userVersion(c: SqlConn): Long = c.query("PRAGMA user_version") { it.getLong(0) }.single()

  /** Mirrors `LazarusDb.onUpgrade(1, 2)`: the migration inside the helper's own transaction. */
  private fun upgrade(c: SqlConn, log: (String) -> Unit): Boolean {
    c.exec("BEGIN")
    val ok = ReminderMigration.migrate(c, log)
    c.exec("PRAGMA user_version = ${StoreSchema.VERSION}")
    c.exec("COMMIT")
    return ok
  }

  private fun row(id: String, num: String = number, slot: Int = 1, txt: String = text, lang: String = "en") =
    ReminderRow(id, num, slot, dueAt = 10_000L + slot, text = txt, language = lang, createdAt = 500L, handedAt = null)

  private fun apply(c: SqlConn, change: StoreChange) =
    StoreSql.forChange(change).forEach { op -> c.exec(op.sql, op.args) }

  private fun reminders(c: SqlConn): List<ReminderRow> =
    c.query(StoreSql.SELECT_REMINDERS) { r ->
      ReminderRow(
        id = r.getString(0)!!,
        number = r.getString(1)!!,
        slot = r.getLong(2).toInt(),
        dueAt = r.getLong(3),
        text = r.getString(4)!!,
        language = r.getString(5)!!,
        createdAt = r.getLong(6),
        handedAt = if (r.isNull(7)) null else r.getLong(7),
      )
    }

  private fun nextDue(c: SqlConn): Long? =
    c.query(StoreSql.SELECT_NEXT_REMINDER_DUE) { if (it.isNull(0)) null else it.getLong(0) }.single()

  private fun assertLogIsPrivate(lines: List<String>) {
    for (line in lines) {
      assertFalse("log holds a number", Regex("\\d{4,}").containsMatchIn(line))
      assertFalse("log holds the number", line.contains(number) || line.contains("923"))
      assertFalse("log holds the text", line.contains(text) || line.contains("medicine"))
    }
  }

  /** Throws on the `CREATE INDEX` statement, i.e. right after `CREATE TABLE reminder` ran. */
  private class FailOnCreateIndex(private val delegate: SqlConn) : SqlConn {
    var thrown = false

    override fun exec(sql: String, args: List<Any?>) {
      if (sql.trimStart().startsWith("CREATE INDEX", ignoreCase = true)) {
        thrown = true
        throw SQLException("injected failure")
      }
      delegate.exec(sql, args)
    }

    override fun <T> query(sql: String, args: List<Any?>, map: (SqlRow) -> T): List<T> =
      delegate.query(sql, args, map)

    override fun <T> savepoint(name: String, block: () -> T): T = delegate.savepoint(name, block)
  }

  // ---- 12.3: version 1 → 2 keeps every row ----

  @Test
  fun upgradeFromVersion1KeepsEveryRowOfEveryTable() {
    val file = File.createTempFile("lazarus-v1", ".db").apply { deleteOnExit() }
    val before: Map<String, List<String>>
    JdbcSqlConn.file(file.path).use { c ->
      seedV1(c)
      before = v1Dump(c)
      assertTrue("every version 1 table has rows", before.values.all { it.isNotEmpty() })
      assertEquals(v1Tables.keys, objectNames(c, "table") - "sqlite_sequence")
    }

    val log = ArrayList<String>()
    JdbcSqlConn.file(file.path).use { c ->
      assertEquals(1L, userVersion(c))
      assertTrue(upgrade(c, log::add))
    }

    // Reopen: the upgrade was committed.
    JdbcSqlConn.file(file.path).use { c ->
      assertEquals(2L, userVersion(c))
      assertEquals(before, v1Dump(c))
      assertTrue("reminder" in objectNames(c, "table"))
      assertTrue("reminder_due" in objectNames(c, "index"))
      assertEquals(emptyList<ReminderRow>(), reminders(c))
      assertNull(nextDue(c))
    }
    assertEquals(emptyList<String>(), log)
  }

  @Test
  fun migrationOnVersion2DatabaseChangesNothing() {
    JdbcSqlConn.inMemory().use { c ->
      seedV1(c)
      assertTrue(upgrade(c) {})
      apply(c, StoreChange.ReminderAdd(row("r1", slot = 1)))
      apply(c, StoreChange.ReminderAdd(row("r2", num = otherNumber, slot = 3, txt = "دوا لینی ہے", lang = "ur")))
      val schemaBefore = schema(c)
      val v1Before = v1Dump(c)
      val remindersBefore = rows(c, "reminder", reminderColumns)

      val log = ArrayList<String>()
      assertTrue(ReminderMigration.migrate(c, log::add))

      assertEquals(schemaBefore, schema(c))
      assertEquals(v1Before, v1Dump(c))
      assertEquals(remindersBefore, rows(c, "reminder", reminderColumns))
      assertEquals(2L, userVersion(c))
      assertEquals(emptyList<String>(), log)
    }
  }

  // ---- 12.4: a failed upgrade rolls back ----

  @Test
  fun failureAfterCreateTableRollsBackAndKeepsVersion1Data() {
    JdbcSqlConn.inMemory().use { c ->
      seedV1(c)
      val before = v1Dump(c)
      val schemaBefore = schema(c)
      val failing = FailOnCreateIndex(c)
      val log = ArrayList<String>()

      // Inside the enclosing onUpgrade-style transaction, which must stay usable afterwards.
      c.exec("BEGIN")
      assertFalse(ReminderMigration.migrate(failing, log::add))
      assertTrue("the failure was injected after CREATE TABLE", failing.thrown)
      assertFalse("reminder table left half-created", "reminder" in objectNames(c, "table"))
      assertFalse("reminder_due" in objectNames(c, "index"))
      c.exec("COMMIT")

      assertEquals(before, v1Dump(c))
      assertEquals(schemaBefore, schema(c))
      assertEquals(1, log.size)
      assertTrue(log.single().startsWith("ReminderMigration: failed"))
      assertLogIsPrivate(log)

      // The DDL is idempotent, so a later open can retry and succeed.
      assertTrue(ReminderMigration.migrate(c) {})
      assertTrue("reminder" in objectNames(c, "table"))
      assertTrue("reminder_due" in objectNames(c, "index"))
      assertEquals(before, v1Dump(c))
    }
  }

  @Test
  fun failureWithoutEnclosingTransactionAlsoRollsBack() {
    JdbcSqlConn.inMemory().use { c ->
      seedV1(c)
      val before = v1Dump(c)
      val log = ArrayList<String>()
      assertFalse(ReminderMigration.migrate(FailOnCreateIndex(c), log::add))
      assertFalse("reminder" in objectNames(c, "table"))
      assertEquals(before, v1Dump(c))
      assertLogIsPrivate(log)
    }
  }

  // ---- 12.2: UNIQUE (number, slot) and CHECK constraints ----

  private fun migrated(): JdbcSqlConn =
    JdbcSqlConn.inMemory().also { c ->
      seedV1(c)
      assertTrue(ReminderMigration.migrate(c) {})
    }

  private fun assertRejected(c: SqlConn, change: StoreChange, expect: String) {
    try {
      apply(c, change)
      fail("accepted a row that should violate $expect")
    } catch (e: SQLException) {
      assertTrue(e.message.orEmpty(), e.message.orEmpty().contains(expect, ignoreCase = true))
    }
  }

  @Test
  fun secondRowWithSameNumberAndSlotIsRejected() {
    migrated().use { c ->
      val first = row("r1", slot = 2)
      apply(c, StoreChange.ReminderAdd(first))
      assertRejected(c, StoreChange.ReminderAdd(row("r2", slot = 2, txt = "other")), "UNIQUE")
      assertEquals(listOf(first), reminders(c))

      // Same slot for another number, and another slot for the same number, are fine.
      apply(c, StoreChange.ReminderAdd(row("r3", num = otherNumber, slot = 2)))
      apply(c, StoreChange.ReminderAdd(row("r4", slot = 3)))
      assertEquals(3, reminders(c).size)
    }
  }

  @Test
  fun checkRejectsSlotZeroAndEmptyText() {
    migrated().use { c ->
      assertRejected(c, StoreChange.ReminderAdd(row("r0", slot = 0)), "CHECK")
      assertRejected(c, StoreChange.ReminderAdd(row("r6", slot = 6)), "CHECK")
      assertRejected(c, StoreChange.ReminderAdd(row("re", txt = "")), "CHECK")
      assertRejected(c, StoreChange.ReminderAdd(row("rl", lang = "fr")), "CHECK")
      assertEquals(emptyList<ReminderRow>(), reminders(c))

      // Boundaries that must pass: slots 1 and 5, 140 UTF-16 code units (70 emoji).
      val emoji = "\uD83D\uDE00".repeat(70)
      assertEquals(140, emoji.length)
      apply(c, StoreChange.ReminderAdd(row("a", slot = 1)))
      apply(c, StoreChange.ReminderAdd(row("b", slot = 5, txt = emoji, lang = "roman-ur")))
      assertEquals(listOf("a", "b"), reminders(c).map { it.id })
      assertEquals(emoji, reminders(c).last().text)
    }
  }

  // ---- StoreSql reminder writes and reads on the migrated table ----

  @Test
  fun storeSqlRemoveHandedAndNextDue() {
    migrated().use { c ->
      apply(c, StoreChange.ReminderAdd(row("r1", slot = 1))) // due 10001
      apply(c, StoreChange.ReminderAdd(row("r2", slot = 2))) // due 10002
      apply(c, StoreChange.ReminderAdd(row("r3", num = otherNumber, slot = 1))) // due 10001
      assertEquals(10_001L, nextDue(c))

      apply(c, StoreChange.ReminderHanded("r1", 20_000L))
      apply(c, StoreChange.ReminderHanded("r3", 20_001L))
      assertEquals(20_000L, reminders(c).single { it.id == "r1" }.handedAt)
      assertEquals(10_002L, nextDue(c))

      apply(c, StoreChange.ReminderRemove("r2"))
      assertNull(nextDue(c))
      assertEquals(listOf("r1", "r3"), reminders(c).map { it.id })

      apply(c, StoreChange.ReminderRemoveAll(number))
      assertEquals(listOf("r3"), reminders(c).map { it.id })
      assertTrue("no row holds the removed text for that number", reminders(c).none { it.number == number })
    }
  }
}
