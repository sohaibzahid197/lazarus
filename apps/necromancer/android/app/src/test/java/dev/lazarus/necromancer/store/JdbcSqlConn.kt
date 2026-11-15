package dev.lazarus.necromancer.store

import java.sql.Connection
import java.sql.DriverManager
import java.sql.PreparedStatement
import java.sql.ResultSet
import java.sql.Types

/**
 * Test-only [SqlConn] over sqlite-jdbc, so migration and table tests run real SQLite on the JVM.
 * The connection stays in auto-commit mode; `SAVEPOINT` then starts and `RELEASE` ends a transaction,
 * as in plain SQLite.
 */
class JdbcSqlConn(private val conn: Connection) : SqlConn, AutoCloseable {
  override fun exec(sql: String, args: List<Any?>) {
    conn.prepareStatement(sql).use { st ->
      bindAll(st, args)
      st.execute()
    }
  }

  override fun <T> query(sql: String, args: List<Any?>, map: (SqlRow) -> T): List<T> =
    conn.prepareStatement(sql).use { st ->
      bindAll(st, args)
      st.executeQuery().use { rs ->
        val row = ResultSetRow(rs)
        val out = ArrayList<T>()
        while (rs.next()) out.add(map(row))
        out
      }
    }

  override fun <T> savepoint(name: String, block: () -> T): T =
    runInSavepoint(name, { sql -> conn.createStatement().use { it.execute(sql) } }, { "ROLLBACK TO $it" }, block)

  override fun close() = conn.close()

  private fun bindAll(st: PreparedStatement, args: List<Any?>) {
    args.forEachIndexed { i, arg ->
      val index = i + 1
      when (arg) {
        null -> st.setNull(index, Types.NULL)
        is String -> st.setString(index, arg)
        is Long -> st.setLong(index, arg)
        is Int -> st.setLong(index, arg.toLong())
        is Double -> st.setDouble(index, arg)
        else -> throw unsupportedArg(arg)
      }
    }
  }

  /** JDBC columns start at 1; [SqlRow] columns start at 0. */
  private class ResultSetRow(private val rs: ResultSet) : SqlRow {
    override fun isNull(index: Int): Boolean = rs.getObject(index + 1) == null

    override fun getLong(index: Int): Long = rs.getLong(index + 1)

    override fun getString(index: Int): String? = rs.getString(index + 1)
  }

  companion object {
    /** A fresh private in-memory database. */
    fun inMemory(): JdbcSqlConn = JdbcSqlConn(DriverManager.getConnection("jdbc:sqlite::memory:"))

    /** A file database, so a test can close and reopen it. */
    fun file(path: String): JdbcSqlConn = JdbcSqlConn(DriverManager.getConnection("jdbc:sqlite:$path"))
  }
}
