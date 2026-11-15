package dev.lazarus.necromancer.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StoreWireTest {
  private val n = "+923001234567"

  @Test
  fun parsesEveryStateChangeVariant() {
    val json =
      """[{"type":"stop-add","number":"$n"},{"type":"stop-remove","number":"$n"},
        |{"type":"rate-record","number":"$n","at":1767225600000},
        |{"type":"slowdown-record","number":"$n","at":5},
        |{"type":"counters","counters":{"dayKey":"2026-01-01","received":1,"repliesSent":0,"replied":0,"partsSent":0,"ignored":0,"handed":0}},
        |{"type":"allow-add","number":"$n"},{"type":"allow-remove","number":"$n"}]""".trimMargin()
    val changes = StoreWire.parseChanges(json)
    assertEquals(
      listOf(
        StoreChange.StopAdd(n),
        StoreChange.StopRemove(n),
        StoreChange.RateRecord(n, 1767225600000L),
        StoreChange.SlowdownRecord(n, 5L),
        StoreChange.Counters(
          """{"dayKey":"2026-01-01","received":1,"repliesSent":0,"replied":0,"partsSent":0,"ignored":0,"handed":0}""",
        ),
        StoreChange.AllowAdd(n),
        StoreChange.AllowRemove(n),
      ),
      changes,
    )
  }

  @Test
  fun rejectsMalformedChanges() {
    val bad =
      listOf(
        "{}",
        "[{\"type\":\"stop-add\",\"number\":\"0300 1234567\"}]",
        "[{\"type\":\"rate-record\",\"number\":\"$n\",\"at\":-1}]",
        "[{\"type\":\"rate-record\",\"number\":\"$n\",\"at\":1.5}]",
        "[{\"type\":\"nope\"}]",
        "[{\"type\":\"counters\",\"counters\":3}]",
        "not json",
      )
    for (json in bad) {
      assertTrue(json, runCatching { StoreWire.parseChanges(json) }.isFailure)
    }
  }

  @Test
  fun stopAddUsesInsertOrIgnoreAndRatePrunes() {
    assertTrue(StoreSql.forChange(StoreChange.StopAdd(n)).single().sql.startsWith("INSERT OR IGNORE INTO stop_list"))
    val rate = StoreSql.forChange(StoreChange.RateRecord(n, 100_000_000L))
    assertEquals(2, rate.size)
    assertEquals(listOf<Any>(100_000_000L - 86_400_000L), rate[1].args)
  }

  @Test
  fun pendingStopHasThreeColumnsAndNoBody() {
    val ddl = StoreSchema.CREATE_STATEMENTS.single { it.startsWith("CREATE TABLE pending_stop") }
    assertEquals(3, ddl.substringAfter('(').split(',').count { it.contains("NOT NULL") })
    assertFalse(ddl.contains("body"))
    assertEquals(listOf<Any>(n, "STOP", 7L), StoreSql.insertPendingStop(n, 7L).args)
  }

  @Test
  fun activityRoundTrip() {
    val entry = StoreWire.parseActivity("""{"receivedAt":12,"who":"•••••••••567","command":"HELP","outcome":"replied"}""")
    assertEquals(ActivityRecord(12L, "•••••••••567", "HELP", "replied"), entry)
    assertEquals(
      """[{"receivedAt":12,"who":"•••••••••567","command":"HELP","outcome":"replied"}]""",
      StoreWire.encodeActivity(listOf(entry)),
    )
    assertTrue(StoreSql.appendActivity(entry)[1].sql.contains("LIMIT 200"))
  }

  @Test
  fun encodesStateForDecodeStoredState() {
    val json =
      StoreWire.encodeState(
        StoredSnapshot(
          stopList = listOf(n),
          allowlist = null,
          rate = mapOf(n to listOf(1L, 2L)),
          slowDown = mapOf(n to 3L),
          countersJson = """{"dayKey":"2026-01-01","received":1}""",
          settings = "{\"v\":1}",
          paused = true,
        ),
      )
    assertEquals(
      """{"stopList":["$n"],"allowlist":null,"rate":[["$n",[1,2]]],"slowDown":[["$n",3]],""" +
        """"counters":{"dayKey":"2026-01-01","received":1},"settings":"{\"v\":1}","paused":true}""",
      json,
    )
  }

  @Test
  fun setupMarksOnlyKnownSteps() {
    assertEquals("""{"autostart":true,"recents":false}""", StoreWire.encodeSetupMarks(mapOf("autostart" to true)))
    assertEquals("setup.recents", StoreWire.setupKey("recents"))
    assertTrue(runCatching { StoreWire.setupKey("battery") }.isFailure)
  }

  @Test
  fun miniJsonRoundTripsStringsWithEscapes() {
    val s = "a\"b\\c\nبند\u0001"
    assertEquals(s, MiniJson.parse(MiniJson.encode(s)))
    assertEquals(42L, MiniJson.parse(" 42 "))
  }
}
