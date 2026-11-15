package dev.lazarus.necromancer.stop

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.FileNotFoundException

/**
 * Requirements 9.13, 17.7: the Kotlin fallback reads the asset generated from @lazarus/brain
 * and gives the same answers as brain `stopKeywordCheck` (stopAliases.unit.test.ts).
 */
class StopKeywordCheckTest {
    private val assetText: String by lazy {
        val path = System.getProperty("lazarus.stopAliasesPath")
            ?: error("lazarus.stopAliasesPath not set; run via Gradle")
        File(path).readText(Charsets.UTF_8)
    }

    private fun realCheck(logs: MutableList<String> = mutableListOf()) =
        StopKeywordCheck(readAsset = { assetText }, log = { logs.add(it) })

    @Test
    fun matchesBrainPassExamples() {
        val check = realCheck()
        listOf("STOP", "stop!", "Band.", "بند", "  STOP please").forEach {
            assertTrue("expected match for '$it'", check.matches(it))
        }
    }

    @Test
    fun rejectsBrainFailExamples() {
        val check = realCheck()
        listOf("STOPPED", "!!! stop", "please stop", "", "ＳＴＯＰ").forEach {
            assertFalse("expected no match for '$it'", check.matches(it))
        }
    }

    @Test
    fun realAssetGivesStopMarkerAndLogsNothing() {
        val logs = mutableListOf<String>()
        val check = realCheck(logs)
        assertEquals("STOP", check.stopMarker())
        assertTrue(logs.isEmpty())
    }

    @Test
    fun missingAssetReturnsFalseAndLogsOnce() {
        val logs = mutableListOf<String>()
        val check = StopKeywordCheck(
            readAsset = { throw FileNotFoundException(StopKeywordCheck.ASSET_NAME) },
            log = { logs.add(it) },
        )
        repeat(3) { assertFalse(check.matches("STOP")) }
        assertNull(check.stopMarker())
        assertEquals(listOf(StopKeywordCheck.UNREADABLE_LINE), logs)
    }

    @Test
    fun unsupportedVersionReturnsFalse() {
        val v2 = assetText.replace("\"v\":1", "\"v\":2")
        val logs = mutableListOf<String>()
        val check = StopKeywordCheck(readAsset = { v2 }, log = { logs.add(it) })
        assertFalse(check.matches("STOP"))
        assertEquals(1, logs.size)
    }

    @Test
    fun invalidJsonReturnsFalse() {
        val logs = mutableListOf<String>()
        val check = StopKeywordCheck(readAsset = { "{not json" }, log = { logs.add(it) })
        assertFalse(check.matches("STOP"))
        assertEquals(1, logs.size)
    }

    @Test
    fun parseRejectsVersionOtherThanOne() {
        assertNull(StopAliasAsset.parse(assetText.replace("\"v\":1", "\"v\":0")))
        assertTrue(StopAliasAsset.parse(assetText) != null)
    }
}
