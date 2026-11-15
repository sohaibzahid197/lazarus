package dev.lazarus.necromancer.store

/** One `StateChange` from brain `serializeChanges` (packages/brain/src/gateway.state.ts). */
sealed class StoreChange {
  data class StopAdd(val number: String) : StoreChange()
  data class StopRemove(val number: String) : StoreChange()
  data class RateRecord(val number: String, val at: Long) : StoreChange()
  data class SlowdownRecord(val number: String, val at: Long) : StoreChange()
  /** Re-encoded DayCounters object, stored as-is in `counters.json`. */
  data class Counters(val json: String) : StoreChange()
  data class AllowAdd(val number: String) : StoreChange()
  data class AllowRemove(val number: String) : StoreChange()
  /** The only change holding body-derived text (the Reminder_Text). Never log it. */
  data class ReminderAdd(val reminder: ReminderRow) : StoreChange()
  data class ReminderRemove(val id: String) : StoreChange()
  data class ReminderRemoveAll(val number: String) : StoreChange()
  data class ReminderHanded(val id: String, val at: Long) : StoreChange()
}

/**
 * One `reminder` row, in the brain `EncodedReminder` key order. [handedAt] is null until the
 * reminder is handed to the Sms_Sender. `toString` hides the number and text so a stray log or
 * exception message cannot leak them (Requirement 13.2).
 */
data class ReminderRow(
  val id: String,
  val number: String,
  val slot: Int,
  val dueAt: Long,
  val text: String,
  val language: String,
  val createdAt: Long,
  val handedAt: Long?,
) {
  override fun toString(): String = "ReminderRow(slot=$slot)"
}

/** One Activity_Entry (`{receivedAt, who, command, outcome}`); `who` is already masked by the brain. */
data class ActivityRecord(val receivedAt: Long, val who: String, val command: String, val outcome: String)

/** One `pending_stop` row plus its SQLite `rowid` (the Pending_Stop_Record `id`). */
data class PendingStopRow(val id: Long, val sender: String, val marker: String, val receivedAt: Long)

/** Everything `loadState()` reports. `allowlist == null` means the read failed (Requirement 4.9). */
data class StoredSnapshot(
  val stopList: List<String>,
  val allowlist: List<String>?,
  val rate: Map<String, List<Long>>,
  val slowDown: Map<String, Long>,
  val countersJson: String?,
  val settings: String?,
  val paused: Boolean,
  /** Active_Reminders; `null` when the Reminder_Store is not ready or its read fails (12.6, 12.7). */
  val reminders: List<ReminderRow>? = null,
)

/**
 * Pure decoding and encoding of the NativeStore JSON wire format.
 * Decoders throw [IllegalArgumentException] for any malformed input so the caller rejects the
 * whole call before touching SQLite. Error messages never contain a number or message text.
 */
object StoreWire {
  private val CANONICAL = Regex("^\\+[1-9]\\d{6,14}$")
  private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L

  /** Brain `REMINDER_LIMIT`: slots are 1..5. */
  const val REMINDER_SLOT_MAX = 5

  /** Brain `REMINDER_TEXT_MAX`, in UTF-16 code units (Kotlin `String.length`, JS `text.length`). */
  const val REMINDER_TEXT_MAX = 140

  /** Brain `LANGUAGES`. */
  val REMINDER_LANGUAGES: Set<String> = setOf("en", "ur", "roman-ur")

  /** The exact key set of one encoded Reminder (brain `EncodedReminder`). */
  private val REMINDER_KEYS: Set<String> =
    setOf("id", "number", "slot", "dueAt", "text", "language", "createdAt", "handedAt")

  fun parseChanges(json: String): List<StoreChange> {
    val root = MiniJson.parse(json)
    require(root is List<*>) { "changes must be an array" }
    return root.mapIndexed { i, item -> parseChange(item, i) }
  }

  private fun parseChange(item: Any?, index: Int): StoreChange {
    require(item is Map<*, *>) { "change $index must be an object" }
    return when (val type = item["type"]) {
      "stop-add" -> StoreChange.StopAdd(number(item, index))
      "stop-remove" -> StoreChange.StopRemove(number(item, index))
      "allow-add" -> StoreChange.AllowAdd(number(item, index))
      "allow-remove" -> StoreChange.AllowRemove(number(item, index))
      "rate-record" -> StoreChange.RateRecord(number(item, index), time(item["at"], "change $index at"))
      "slowdown-record" -> StoreChange.SlowdownRecord(number(item, index), time(item["at"], "change $index at"))
      "counters" -> {
        val counters = item["counters"]
        require(counters is Map<*, *>) { "change $index counters must be an object" }
        StoreChange.Counters(MiniJson.encode(counters))
      }
      "reminder-add" -> StoreChange.ReminderAdd(reminder(item["reminder"], index))
      "reminder-remove" -> StoreChange.ReminderRemove(id(item["id"], "change $index id"))
      "reminder-remove-all" -> StoreChange.ReminderRemoveAll(number(item, index))
      "reminder-handed" ->
        StoreChange.ReminderHanded(id(item["id"], "change $index id"), time(item["at"], "change $index at"))
      else -> throw IllegalArgumentException("change $index has unknown type ${if (type is String) type else "?"}")
    }
  }

  private fun number(item: Map<*, *>, index: Int): String {
    val n = item["number"]
    require(n is String && CANONICAL.matches(n)) { "change $index number is not canonical" }
    return n
  }

  /**
   * Strict `reminder-add` payload: exactly the 8 keys, canonical number, slot 1–5, text of
   * 1–140 UTF-16 code units with no lone surrogate, a known language and safe-integer times.
   * Messages name only the field, never its value.
   */
  private fun reminder(value: Any?, index: Int): ReminderRow {
    val what = "change $index reminder"
    require(value is Map<*, *>) { "$what must be an object" }
    require(value.keys == REMINDER_KEYS) { "$what has the wrong keys" }
    val number = value["number"]
    require(number is String && CANONICAL.matches(number)) { "$what number is not canonical" }
    val text = value["text"]
    require(text is String && isReminderText(text)) { "$what text is not a valid Reminder_Text" }
    val language = value["language"]
    require(language is String && language in REMINDER_LANGUAGES) { "$what language is unknown" }
    val handedAt = value["handedAt"]
    return ReminderRow(
      id = id(value["id"], "$what id"),
      number = number,
      slot = slot(value["slot"], "$what slot"),
      dueAt = time(value["dueAt"], "$what dueAt"),
      text = text,
      language = language,
      createdAt = time(value["createdAt"], "$what createdAt"),
      handedAt = if (handedAt == null) null else time(handedAt, "$what handedAt"),
    )
  }

  private fun id(value: Any?, what: String): String {
    require(value is String) { "$what must be a string" }
    return value
  }

  private fun slot(value: Any?, what: String): Int {
    val s = time(value, what)
    require(s in 1..REMINDER_SLOT_MAX) { "$what must be between 1 and $REMINDER_SLOT_MAX" }
    return s.toInt()
  }

  /** 1–140 UTF-16 code units and well-formed UTF-16 (a lone surrogate has no UTF-8 form). */
  fun isReminderText(text: String): Boolean =
    text.length in 1..REMINDER_TEXT_MAX && !hasLoneSurrogate(text)

  private fun hasLoneSurrogate(s: String): Boolean {
    var i = 0
    while (i < s.length) {
      val c = s[i]
      if (c.isHighSurrogate()) {
        if (i + 1 >= s.length || !s[i + 1].isLowSurrogate()) return true
        i += 2
      } else {
        if (c.isLowSurrogate()) return true
        i += 1
      }
    }
    return false
  }

  /** A non-negative safe integer from a JSON number (Long, or an integral Double). */
  fun time(value: Any?, what: String): Long {
    val t =
      when (value) {
        is Long -> value
        is Double -> if (value.isFinite() && value == Math.floor(value)) value.toLong() else null
        else -> null
      }
    require(t != null && t in 0..MAX_SAFE_INTEGER) { "$what must be a non-negative integer" }
    return t
  }

  fun parseActivity(json: String): ActivityRecord {
    val root = MiniJson.parse(json)
    require(root is Map<*, *>) { "activity entry must be an object" }
    val who = root["who"]
    val command = root["command"]
    val outcome = root["outcome"]
    require(who is String && command is String && outcome is String) { "activity entry fields must be strings" }
    return ActivityRecord(time(root["receivedAt"], "activity receivedAt"), who, command, outcome)
  }

  /** JSON array for `loadActivity()`, in the given order (newest first). */
  fun encodeActivity(entries: List<ActivityRecord>): String =
    MiniJson.encode(
      entries.map {
        linkedMapOf("receivedAt" to it.receivedAt, "who" to it.who, "command" to it.command, "outcome" to it.outcome)
      },
    )

  /** JSON for `loadState()`, decoded by brain `decodeStoredState`. */
  fun encodeState(s: StoredSnapshot): String {
    val counters = s.countersJson?.let { runCatching { MiniJson.parse(it) }.getOrNull() as? Map<*, *> }
    return MiniJson.encode(
      linkedMapOf(
        "stopList" to s.stopList,
        "allowlist" to s.allowlist,
        "rate" to s.rate.map { (n, times) -> listOf(n, times) },
        "slowDown" to s.slowDown.map { (n, t) -> listOf(n, t) },
        "counters" to counters,
        "settings" to s.settings,
        "paused" to s.paused,
        "reminders" to s.reminders?.map(::encodeReminder),
      ),
    )
  }

  /** One row as brain `EncodedReminder` (same 8 keys, same order); `handedAt` null or integer. */
  fun encodeReminder(r: ReminderRow): Map<String, Any?> =
    linkedMapOf(
      "id" to r.id,
      "number" to r.number,
      "slot" to r.slot.toLong(),
      "dueAt" to r.dueAt,
      "text" to r.text,
      "language" to r.language,
      "createdAt" to r.createdAt,
      "handedAt" to r.handedAt,
    )

  /** JSON array for `takePendingStops()`, decoded by brain `decodePendingStopRecord`. */
  fun encodePendingStops(rows: List<PendingStopRow>): String =
    MiniJson.encode(
      rows.map { linkedMapOf("id" to it.id, "sender" to it.sender, "marker" to it.marker, "receivedAt" to it.receivedAt) },
    )

  fun encodeSetupMarks(marks: Map<String, Boolean>): String =
    MiniJson.encode(StoreSchema.SETUP_STEPS.associateWith { marks[it] == true })

  fun setupKey(step: String): String {
    require(step in StoreSchema.SETUP_STEPS) { "unknown setup step" }
    return StoreSchema.KV_SETUP_PREFIX + step
  }
}
