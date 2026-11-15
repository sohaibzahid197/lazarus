package dev.lazarus.necromancer.stop

/**
 * Minimal strict JSON reader for the small `stop_aliases.json` asset.
 * Pure Kotlin (no org.json) so JVM unit tests can run it without Android stubs.
 * Values: Map<String, Any?>, List<Any?>, String, Double, Boolean, null.
 * Throws [IllegalArgumentException] on malformed input.
 */
internal class MiniJson private constructor(private val src: String) {
    private var pos = 0

    companion object {
        fun parse(src: String): Any? {
            val p = MiniJson(src)
            p.skipWs()
            val value = p.readValue()
            p.skipWs()
            require(p.pos == src.length) { "trailing data" }
            return value
        }
    }

    private fun skipWs() {
        while (pos < src.length && src[pos] in " \t\n\r") pos++
    }

    private fun peek(): Char {
        require(pos < src.length) { "unexpected end" }
        return src[pos]
    }

    private fun expect(c: Char) {
        require(peek() == c) { "expected $c" }
        pos++
    }

    private fun readValue(): Any? = when (peek()) {
        '{' -> readObject()
        '[' -> readArray()
        '"' -> readString()
        't' -> readLiteral("true", true)
        'f' -> readLiteral("false", false)
        'n' -> readLiteral("null", null)
        else -> readNumber()
    }

    private fun readLiteral(word: String, value: Any?): Any? {
        require(src.startsWith(word, pos)) { "bad literal" }
        pos += word.length
        return value
    }

    private fun readObject(): Map<String, Any?> {
        expect('{')
        val out = LinkedHashMap<String, Any?>()
        skipWs()
        if (peek() == '}') { pos++; return out }
        while (true) {
            skipWs()
            val key = readString()
            skipWs()
            expect(':')
            skipWs()
            require(!out.containsKey(key)) { "duplicate key" }
            out[key] = readValue()
            skipWs()
            if (peek() == ',') { pos++; continue }
            expect('}')
            return out
        }
    }

    private fun readArray(): List<Any?> {
        expect('[')
        val out = ArrayList<Any?>()
        skipWs()
        if (peek() == ']') { pos++; return out }
        while (true) {
            skipWs()
            out.add(readValue())
            skipWs()
            if (peek() == ',') { pos++; continue }
            expect(']')
            return out
        }
    }

    private fun readString(): String {
        expect('"')
        val sb = StringBuilder()
        while (true) {
            val c = peek()
            pos++
            when {
                c == '"' -> return sb.toString()
                c == '\\' -> sb.append(readEscape())
                c < ' ' -> throw IllegalArgumentException("control char in string")
                else -> sb.append(c)
            }
        }
    }

    private fun readEscape(): Char {
        val c = peek()
        pos++
        return when (c) {
            '"' -> '"'
            '\\' -> '\\'
            '/' -> '/'
            'b' -> '\b'
            'f' -> '\u000C'
            'n' -> '\n'
            'r' -> '\r'
            't' -> '\t'
            'u' -> {
                require(pos + 4 <= src.length) { "short \\u escape" }
                val code = src.substring(pos, pos + 4).toInt(16)
                pos += 4
                code.toChar()
            }
            else -> throw IllegalArgumentException("bad escape")
        }
    }

    private fun readNumber(): Double {
        val start = pos
        while (pos < src.length && src[pos] in "+-0123456789.eE") pos++
        require(pos > start) { "unexpected char" }
        return src.substring(start, pos).toDouble()
    }
}
