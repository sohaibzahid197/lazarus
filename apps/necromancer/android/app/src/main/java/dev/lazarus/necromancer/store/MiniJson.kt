package dev.lazarus.necromancer.store

/**
 * Minimal JSON reader and writer in plain Kotlin, so the store's wire-format code can be
 * tested on the JVM without Android's `org.json` stubs.
 *
 * Values: `null`, [Boolean], [Long] (integer literals that fit), [Double] (other numbers),
 * [String], [List] and [Map] with [String] keys (insertion order kept).
 */
object MiniJson {
  class ParseException(message: String) : IllegalArgumentException(message)

  fun parse(text: String): Any? {
    val reader = Reader(text)
    reader.skipWhitespace()
    val value = reader.readValue()
    reader.skipWhitespace()
    if (!reader.atEnd()) throw ParseException("trailing data at ${reader.pos}")
    return value
  }

  fun encode(value: Any?): String = StringBuilder().also { write(it, value) }.toString()

  private fun write(out: StringBuilder, value: Any?) {
    when (value) {
      null -> out.append("null")
      is Boolean -> out.append(if (value) "true" else "false")
      is Long, is Int -> out.append(value.toString())
      is Double -> writeDouble(out, value)
      is String -> writeString(out, value)
      is Map<*, *> -> writeObject(out, value)
      is Iterable<*> -> writeArray(out, value)
      else -> throw IllegalArgumentException("unsupported JSON value ${value::class.java.simpleName}")
    }
  }

  private fun writeDouble(out: StringBuilder, value: Double) {
    require(value.isFinite()) { "non-finite number" }
    val asLong = value.toLong()
    if (asLong.toDouble() == value) out.append(asLong) else out.append(value)
  }

  private fun writeObject(out: StringBuilder, map: Map<*, *>) {
    out.append('{')
    var first = true
    for ((k, v) in map) {
      require(k is String) { "object key must be a string" }
      if (!first) out.append(',')
      first = false
      writeString(out, k)
      out.append(':')
      write(out, v)
    }
    out.append('}')
  }

  private fun writeArray(out: StringBuilder, items: Iterable<*>) {
    out.append('[')
    var first = true
    for (item in items) {
      if (!first) out.append(',')
      first = false
      write(out, item)
    }
    out.append(']')
  }

  private fun writeString(out: StringBuilder, s: String) {
    out.append('"')
    for (c in s) {
      when (c) {
        '"' -> out.append("\\\"")
        '\\' -> out.append("\\\\")
        '\n' -> out.append("\\n")
        '\r' -> out.append("\\r")
        '\t' -> out.append("\\t")
        '\b' -> out.append("\\b")
        '\u000C' -> out.append("\\f")
        else ->
          if (c < ' ' || c == '\u2028' || c == '\u2029') {
            out.append("\\u").append(String.format("%04x", c.code))
          } else {
            out.append(c)
          }
      }
    }
    out.append('"')
  }

  private class Reader(private val s: String) {
    var pos = 0

    fun atEnd() = pos >= s.length

    fun skipWhitespace() {
      while (pos < s.length && s[pos] in " \t\r\n") pos++
    }

    fun readValue(): Any? {
      if (atEnd()) throw ParseException("unexpected end")
      return when (val c = s[pos]) {
        '{' -> readObject()
        '[' -> readArray()
        '"' -> readString()
        't' -> literal("true", true)
        'f' -> literal("false", false)
        'n' -> literal("null", null)
        else -> if (c == '-' || c in '0'..'9') readNumber() else throw ParseException("unexpected '$c' at $pos")
      }
    }

    private fun literal(word: String, value: Any?): Any? {
      if (!s.startsWith(word, pos)) throw ParseException("bad literal at $pos")
      pos += word.length
      return value
    }

    private fun expect(c: Char) {
      if (atEnd() || s[pos] != c) throw ParseException("expected '$c' at $pos")
      pos++
    }

    private fun readObject(): Map<String, Any?> {
      expect('{')
      val out = LinkedHashMap<String, Any?>()
      skipWhitespace()
      if (!atEnd() && s[pos] == '}') {
        pos++
        return out
      }
      while (true) {
        skipWhitespace()
        val key = readString()
        skipWhitespace()
        expect(':')
        skipWhitespace()
        out[key] = readValue()
        skipWhitespace()
        if (!atEnd() && s[pos] == ',') {
          pos++
          continue
        }
        expect('}')
        return out
      }
    }

    private fun readArray(): List<Any?> {
      expect('[')
      val out = ArrayList<Any?>()
      skipWhitespace()
      if (!atEnd() && s[pos] == ']') {
        pos++
        return out
      }
      while (true) {
        skipWhitespace()
        out.add(readValue())
        skipWhitespace()
        if (!atEnd() && s[pos] == ',') {
          pos++
          continue
        }
        expect(']')
        return out
      }
    }

    private fun readString(): String {
      expect('"')
      val out = StringBuilder()
      while (true) {
        if (atEnd()) throw ParseException("unterminated string")
        val c = s[pos++]
        when {
          c == '"' -> return out.toString()
          c == '\\' -> out.append(readEscape())
          c < ' ' -> throw ParseException("control character in string")
          else -> out.append(c)
        }
      }
    }

    private fun readEscape(): Char {
      if (atEnd()) throw ParseException("unterminated escape")
      return when (val e = s[pos++]) {
        '"' -> '"'
        '\\' -> '\\'
        '/' -> '/'
        'b' -> '\b'
        'f' -> '\u000C'
        'n' -> '\n'
        'r' -> '\r'
        't' -> '\t'
        'u' -> {
          if (pos + 4 > s.length) throw ParseException("short unicode escape")
          val code = s.substring(pos, pos + 4).toIntOrNull(16) ?: throw ParseException("bad unicode escape")
          pos += 4
          code.toChar()
        }
        else -> throw ParseException("bad escape '$e'")
      }
    }

    private fun readNumber(): Any {
      val start = pos
      if (s[pos] == '-') pos++
      while (pos < s.length && s[pos] in "0123456789+-.eE") pos++
      val token = s.substring(start, pos)
      val isInteger = token.none { it == '.' || it == 'e' || it == 'E' }
      if (isInteger) token.toLongOrNull()?.let { return it }
      val d = token.toDoubleOrNull() ?: throw ParseException("bad number at $start")
      if (!d.isFinite()) throw ParseException("number out of range at $start")
      return d
    }
  }
}
