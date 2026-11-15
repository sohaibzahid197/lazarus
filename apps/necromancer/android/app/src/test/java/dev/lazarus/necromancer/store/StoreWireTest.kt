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
        """"counters":{"dayKey":"2026-01-01","received":1},"settings":"{\"v\":1}","paused":true,"reminders":null}""",
      json,
    )
  }

  @Test
  fun setupMarksOnlyKnownSteps() {
    assertEquals("""{"autostart":true,"recents":false}""", StoreWire.encodeSetupMarks(mapOf("autostart" to true)))
    assertEquals("setup.recents", StoreWire.setupKey("recents"))
    assertTrue(runCatching { StoreWire.setupKey("battery") }.isFailure)
  }

  // ---- Reminder changes (Requirements 12.7, 12.11, 13.2) ----

  private val secretText = "take medicine"

  private fun reminderJson(
    number: String = n,
    slot: String = "1",
    text: String = MiniJson.encode(secretText),
    language: String = "\"en\"",
    handedAt: String = "null",
    extra: String = "",
  ): String =
    """[{"type":"reminder-add","reminder":{"id":"r:msg-1","number":"$number","slot":$slot,"dueAt":1704200000000,""" +
      """"text":$text,"language":$language,"createdAt":1704190000000,"handedAt":$handedAt$extra}}]"""

  private fun parsedRow(json: String): ReminderRow =
    (StoreWire.parseChanges(json).single() as StoreChange.ReminderAdd).reminder

  /** Asserts rejection and that the message leaks neither the number nor the text. */
  private fun assertRejectedQuietly(json: String, number: String = n, text: String = secretText) {
    val error = runCatching { StoreWire.parseChanges(json) }.exceptionOrNull()
    assertTrue(json, error is IllegalArgumentException)
    val message = error!!.message.orEmpty()
    assertFalse(message, message.contains(number))
    assertFalse(message, message.contains(number.takeLast(7)))
    if (text.isNotEmpty()) assertFalse(message, message.contains(text))
  }

  @Test
  fun parsesBrainSerializeChangesLiteral() {
    // Copied from packages/brain/src/gateway.state.unit.test.ts ("round trips the reminder change types").
    val json =
      "[" +
        """{"type":"reminder-add","reminder":{"id":"r:msg-1","number":"+923001234567","slot":1,"dueAt":1704200000000,"text":"take medicine","language":"en","createdAt":1704190000000,"handedAt":null}},""" +
        """{"type":"reminder-add","reminder":{"id":"r:msg-2","number":"+923331112223","slot":2,"dueAt":1704300000000,"text":"دوا لیں","language":"ur","createdAt":1704195000000,"handedAt":1704300000500}},""" +
        """{"type":"reminder-remove","id":"r:msg-1"},""" +
        """{"type":"reminder-remove-all","number":"+923331112223"},""" +
        """{"type":"reminder-handed","id":"r:msg-2","at":1704300000500}""" +
        "]"
    val r1 = ReminderRow("r:msg-1", "+923001234567", 1, 1704200000000L, "take medicine", "en", 1704190000000L, null)
    val r2 = ReminderRow("r:msg-2", "+923331112223", 2, 1704300000000L, "دوا لیں", "ur", 1704195000000L, 1704300000500L)
    assertEquals(
      listOf(
        StoreChange.ReminderAdd(r1),
        StoreChange.ReminderAdd(r2),
        StoreChange.ReminderRemove("r:msg-1"),
        StoreChange.ReminderRemoveAll("+923331112223"),
        StoreChange.ReminderHanded("r:msg-2", 1704300000500L),
      ),
      StoreWire.parseChanges(json),
    )
  }

  @Test
  fun acceptsReminderBoundaries() {
    for (slot in 1..5) assertEquals(slot, parsedRow(reminderJson(slot = "$slot")).slot)
    for (lang in listOf("en", "ur", "roman-ur")) assertEquals(lang, parsedRow(reminderJson(language = "\"$lang\"")).language)
    val urdu = "ب".repeat(140)
    assertEquals(urdu, parsedRow(reminderJson(text = MiniJson.encode(urdu))).text)
    val emoji = "😀".repeat(70)
    assertEquals(140, emoji.length)
    assertEquals(emoji, parsedRow(reminderJson(text = MiniJson.encode(emoji))).text)
    assertEquals("a", parsedRow(reminderJson(text = "\"a\"")).text)
    assertEquals(0L, parsedRow(reminderJson(handedAt = "0")).handedAt)
    assertEquals(9_007_199_254_740_991L, parsedRow(reminderJson(handedAt = "9007199254740991")).handedAt)
  }

  @Test
  fun rejectsMalformedReminderAddWithoutLeakingNumberOrText() {
    val seventyOneEmoji = "😀".repeat(71)
    val seventyEmojiPlusLetter = "😀".repeat(70) + "a"
    assertEquals(142, seventyOneEmoji.length)
    assertEquals(141, seventyEmojiPlusLetter.length)
    assertRejectedQuietly(reminderJson(slot = "6"))
    assertRejectedQuietly(reminderJson(slot = "0"))
    assertRejectedQuietly(reminderJson(language = "\"fr\""))
    assertRejectedQuietly(reminderJson(language = "\"EN\""))
    assertRejectedQuietly(reminderJson(text = MiniJson.encode(seventyOneEmoji)), text = seventyOneEmoji)
    assertRejectedQuietly(reminderJson(text = MiniJson.encode(seventyEmojiPlusLetter)), text = seventyEmojiPlusLetter)
    assertRejectedQuietly(reminderJson(text = MiniJson.encode("a".repeat(141))), text = "a".repeat(141))
    assertRejectedQuietly(reminderJson(text = "\"\""), text = "")
    // Lone high surrogate, lone low surrogate, and a reversed pair, written as JSON escapes.
    assertRejectedQuietly(reminderJson(text = "\"take medicine \\ud83d\""))
    assertRejectedQuietly(reminderJson(text = "\"take medicine \\ude00\""))
    assertRejectedQuietly(reminderJson(text = "\"take medicine \\ude00\\ud83d\""))
    assertRejectedQuietly(reminderJson(number = "03001234567"), number = "03001234567")
    assertRejectedQuietly(reminderJson(extra = ",\"extra\":1"))
    assertRejectedQuietly(
      """[{"type":"reminder-add","reminder":{"id":"r:msg-1","number":"$n","slot":1,"dueAt":1,"text":"take medicine","language":"en","createdAt":1}}]""",
    )
    assertRejectedQuietly(reminderJson(handedAt = "-1"))
    assertRejectedQuietly(reminderJson(handedAt = "1.5"))
    assertRejectedQuietly(reminderJson(handedAt = "9007199254740992"))
    assertRejectedQuietly(reminderJson(handedAt = "\"soon\""))
    assertRejectedQuietly(reminderJson(slot = "\"1\""))
    assertRejectedQuietly(reminderJson(slot = "1.5"))
    assertRejectedQuietly("""[{"type":"reminder-add","reminder":null}]""")
  }

  @Test
  fun rejectsMalformedReminderRemoveRemoveAllAndHanded() {
    for (json in
      listOf(
        """[{"type":"reminder-remove"}]""",
        """[{"type":"reminder-remove","id":7}]""",
        """[{"type":"reminder-remove-all","number":"03001234567"}]""",
        """[{"type":"reminder-remove-all"}]""",
        """[{"type":"reminder-handed","id":"r:msg-1"}]""",
        """[{"type":"reminder-handed","id":"r:msg-1","at":-1}]""",
        """[{"type":"reminder-handed","at":5}]""",
      )) {
      assertRejectedQuietly(json, number = "03001234567")
    }
  }

  @Test
  fun encodesRemindersInStateInBrainKeyOrder() {
    val urdu = "دوا لیں"
    val rows =
      listOf(
        ReminderRow("r:msg-1", n, 1, 1704200000000L, secretText, "en", 1704190000000L, null),
        ReminderRow("r:msg-2", "+923331112223", 2, 1704300000000L, urdu, "ur", 1704195000000L, 1704300000500L),
      )
    val json =
      StoreWire.encodeState(
        StoredSnapshot(listOf(), listOf(), mapOf(), mapOf(), null, null, false, reminders = rows),
      )
    assertEquals(
      """{"stopList":[],"allowlist":[],"rate":[],"slowDown":[],"counters":null,"settings":null,"paused":false,"reminders":[""" +
        """{"id":"r:msg-1","number":"$n","slot":1,"dueAt":1704200000000,"text":"take medicine","language":"en","createdAt":1704190000000,"handedAt":null},""" +
        """{"id":"r:msg-2","number":"+923331112223","slot":2,"dueAt":1704300000000,"text":"$urdu","language":"ur","createdAt":1704195000000,"handedAt":1704300000500}]}""",
      json,
    )
    // Encoded rows parse back through reminder-add unchanged.
    for (row in rows) {
      val change = MiniJson.encode(listOf(linkedMapOf("type" to "reminder-add", "reminder" to StoreWire.encodeReminder(row))))
      assertEquals(row, parsedRow(change))
    }
    assertEquals(listOf("id", "number", "slot", "dueAt", "text", "language", "createdAt", "handedAt"), StoreWire.encodeReminder(rows[0]).keys.toList())
  }

  @Test
  fun reminderRowToStringHidesNumberAndText() {
    val row = ReminderRow("r:msg-1", n, 3, 1L, secretText, "en", 1L, null)
    val shown = row.toString() + StoreChange.ReminderAdd(row).toString()
    assertFalse(shown, shown.contains(n))
    assertFalse(shown, shown.contains("1234567"))
    assertFalse(shown, shown.contains(secretText))
    assertTrue(shown, shown.contains("slot=3"))
  }

  @Test
  fun miniJsonRoundTripsStringsWithEscapes() {
    val s = "a\"b\\c\nبند\u0001"
    assertEquals(s, MiniJson.parse(MiniJson.encode(s)))
    assertEquals(42L, MiniJson.parse(" 42 "))
  }
}
