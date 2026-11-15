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
)

/**
 * Pure decoding and encoding of the NativeStore JSON wire format.
 * Decoders throw [IllegalArgumentException] for any malformed input so the caller rejects the
 * whole call before touching SQLite. Error messages never contain a number or message text.
 */
object StoreWire {
  private val CANONICAL = Regex("^\\+[1-9]\\d{6,14}$")
  private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L

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
      else -> throw IllegalArgumentException("change $index has unknown type ${if (type is String) type else "?"}")
    }
  }

  private fun number(item: Map<*, *>, index: Int): String {
    val n = item["number"]
    require(n is String && CANONICAL.matches(n)) { "change $index number is not canonical" }
    return n
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
      ),
    )
  }

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
