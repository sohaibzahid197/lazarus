package dev.lazarus.necromancer.stop

import java.util.Locale

/**
 * The build-time `stop_aliases.json` asset generated from `@lazarus/brain` `stopAliasAsset()`:
 * `{"v":1,"aliases":[...],"trailingPunctuation":"...","stopMarker":"..."}`.
 * Kotlin keeps no keyword, punctuation or marker literal (Requirement 9.13, 17.7).
 * Pure Kotlin, no Android dependencies.
 */
class StopAliasAsset private constructor(
    val aliases: Set<String>,
    val trailingPunctuation: String,
    val stopMarker: String,
) {
    /**
     * Same steps as brain `stopKeywordCheck` (packages/brain/src/stopAliases.ts):
     * trim, empty → false, first whitespace-separated token, strip the trailing run of
     * [trailingPunctuation] characters, lowercase, membership in [aliases].
     *
     * Whitespace follows the JS `trim()` / `\s` set ([JsWhitespace]) rather than Kotlin's
     * `Char.isWhitespace`, which differs on U+FEFF (JS: space, Kotlin: not) and
     * U+001C..U+001F (JS: not, Kotlin: space). Lowercasing uses `Locale.ROOT`, which matches
     * JS `toLowerCase()` for the alias scripts in use (Latin, Arabic/Urdu).
     */
    fun matches(body: String): Boolean {
        val trimmed = JsWhitespace.trim(body)
        if (trimmed.isEmpty()) return false
        val token = JsWhitespace.firstToken(trimmed)
        val keyword = token.trimEnd { it in trailingPunctuation }.lowercase(Locale.ROOT)
        return keyword in aliases
    }

    companion object {
        const val SUPPORTED_VERSION = 1

        /** Parses the asset text; returns null unless it is valid JSON with `v == 1` and the expected fields. */
        fun parse(json: String): StopAliasAsset? {
            val root = try {
                MiniJson.parse(json)
            } catch (e: IllegalArgumentException) {
                return null
            } as? Map<*, *> ?: return null
            val v = root["v"] as? Double ?: return null
            if (v != SUPPORTED_VERSION.toDouble()) return null
            val rawAliases = root["aliases"] as? List<*> ?: return null
            val aliases = rawAliases.map { it as? String ?: return null }
            if (aliases.isEmpty() || aliases.any { it.isEmpty() }) return null
            val punctuation = root["trailingPunctuation"] as? String ?: return null
            val marker = root["stopMarker"] as? String ?: return null
            if (marker.isEmpty()) return null
            return StopAliasAsset(aliases.toSet(), punctuation, marker)
        }
    }
}

/** The ECMAScript WhiteSpace + LineTerminator set used by JS `String.prototype.trim` and `\s`. */
internal object JsWhitespace {
    fun isJsWhitespace(c: Char): Boolean = when (c) {
        '\u0009', '\u000A', '\u000B', '\u000C', '\u000D', '\u0020', '\u00A0',
        '\u2028', '\u2029', '\uFEFF' -> true
        else -> Character.getType(c) == Character.SPACE_SEPARATOR.toInt()
    }

    fun trim(s: String): String = s.trim { isJsWhitespace(it) }

    /** Text before the first whitespace character; [s] must already be trimmed. */
    fun firstToken(s: String): String {
        val end = s.indexOfFirst { isJsWhitespace(it) }
        return if (end < 0) s else s.substring(0, end)
    }
}
