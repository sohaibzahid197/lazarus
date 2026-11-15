package dev.lazarus.necromancer.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** The shared savepoint logic and the JDBC test adapter, on real SQLite. */
class SqlConnTest {
  private fun conn(): JdbcSqlConn =
    JdbcSqlConn.inMemory().also { it.exec("CREATE TABLE t (k TEXT PRIMARY KEY, v INTEGER)") }

  private fun keys(c: SqlConn): List<String> = c.query("SELECT k FROM t ORDER BY k") { it.getString(0)!! }

  @Test
  fun execAndQueryBindTypedArgs() {
    conn().use { c ->
      c.exec("INSERT INTO t(k, v) VALUES (?, ?)", listOf("a", 5L))
      c.exec("INSERT INTO t(k, v) VALUES (?, ?)", listOf("b", null))
      val rows = c.query("SELECT k, v FROM t WHERE v > ? OR v IS NULL ORDER BY k", listOf(4)) { r ->
        Triple(r.getString(0), r.isNull(1), if (r.isNull(1)) null else r.getLong(1))
      }
      assertEquals(listOf(Triple("a", false, 5L), Triple("b", true, null)), rows)
      assertNull(c.query("SELECT MIN(v) FROM t WHERE k = ?", listOf("zz")) { it.getString(0) }.single())
    }
  }

  @Test
  fun savepointKeepsWorkOnSuccess() {
    conn().use { c ->
      val result = c.savepoint("v2") { c.exec("INSERT INTO t(k) VALUES ('a')"); 7 }
      assertEquals(7, result)
      assertEquals(listOf("a"), keys(c))
    }
  }

  @Test
  fun savepointRollsBackOnlyItsOwnWorkAndRethrows() {
    conn().use { c ->
      c.exec("INSERT INTO t(k) VALUES ('before')")
      try {
        c.savepoint("v2") {
          c.exec("INSERT INTO t(k) VALUES ('inside')")
          c.exec("INSERT INTO t(k) VALUES ('inside')") // UNIQUE violation
        }
        fail("expected the constraint error to propagate")
      } catch (e: java.sql.SQLException) {
        assertTrue(e.message.orEmpty().contains("UNIQUE", ignoreCase = true))
      }
      assertEquals(listOf("before"), keys(c))
      // The savepoint was released, so a new one with the same name works.
      c.savepoint("v2") { c.exec("INSERT INTO t(k) VALUES ('after')") }
      assertEquals(listOf("after", "before"), keys(c))
    }
  }

  @Test
  fun nestedSavepointRollbackKeepsOuterWork() {
    conn().use { c ->
      c.savepoint("outer") {
        c.exec("INSERT INTO t(k) VALUES ('outer')")
        runCatching { c.savepoint("inner") { c.exec("INSERT INTO t(k) VALUES ('inner')"); error("boom") } }
      }
      assertEquals(listOf("outer"), keys(c))
    }
  }

  @Test
  fun rejectsUnsafeSavepointNamesAndArgTypes() {
    conn().use { c ->
      for (name in listOf("", "1v", "v2; DROP TABLE t", "a-b")) {
        try {
          c.savepoint(name) { }
          fail("accepted savepoint name")
        } catch (e: IllegalArgumentException) {
          assertFalse(e.message.orEmpty().contains("DROP"))
        }
      }
      try {
        c.exec("INSERT INTO t(k) VALUES (?)", listOf(listOf("+923001234567")))
        fail("accepted list arg")
      } catch (e: IllegalArgumentException) {
        assertFalse(e.message.orEmpty().contains("923"))
      }
      assertEquals(listOf("t"), c.query("SELECT name FROM sqlite_master WHERE type = 'table'") { it.getString(0)!! })
    }
  }
}
