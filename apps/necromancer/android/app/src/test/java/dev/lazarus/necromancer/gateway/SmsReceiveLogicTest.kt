package dev.lazarus.necromancer.gateway

import dev.lazarus.necromancer.log.LogMask
import dev.lazarus.necromancer.stop.PendingStopSink
import dev.lazarus.necromancer.stop.PendingStopStore
import dev.lazarus.necromancer.stop.StopKeywordCheck
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Requirements 1.2, 1.3, 9.13, 9.14, 14.13, 14.14: PDU grouping, branch selection and the
 * refused Paused_Path_Task path of `SmsReceiver`.
 */
class SmsReceiveLogicTest {
    private val sender = "+923001234567"
    private val other = "+923339876543"

    // ---- PDU grouping (1.2, 1.3, 1.9) ----

    @Test
    fun oneSenderMultiPartIsJoinedInPduOrder() {
        val result = SmsReceiveLogic.group(
            listOf(PduPart(sender, "Hello "), PduPart(sender, "from "), PduPart(sender, "Lazarus")),
        )
        assertEquals(listOf(ReceivedSms(sender, "Hello from Lazarus")), result.messages)
        assertTrue(result.failureLines.isEmpty())
    }

    @Test
    fun twoSendersFormTwoMessagesInFirstAppearanceOrder() {
        val result = SmsReceiveLogic.group(
            listOf(
                PduPart(other, "A1"),
                PduPart(sender, "B1"),
                PduPart(other, "A2"),
                PduPart(sender, "B2"),
            ),
        )
        assertEquals(listOf(ReceivedSms(other, "A1A2"), ReceivedSms(sender, "B1B2")), result.messages)
        assertTrue(result.failureLines.isEmpty())
    }

    @Test
    fun ucs2UrduBodiesAreJoinedUnchanged() {
        val part1 = "گندم کی قیمت "
        val part2 = "کیا ہے؟"
        val result = SmsReceiveLogic.group(listOf(PduPart(sender, part1), PduPart(sender, part2)))
        assertEquals(listOf(ReceivedSms(sender, part1 + part2)), result.messages)
        assertEquals("گندم کی قیمت کیا ہے؟", result.messages.single().body)
    }

    @Test
    fun nullAddressPdusGiveOneFailureLine() {
        val result = SmsReceiveLogic.group(
            listOf(PduPart(null, "x"), PduPart(null, "y"), PduPart(sender, "ok")),
        )
        assertEquals(listOf(ReceivedSms(sender, "ok")), result.messages)
        assertEquals(
            listOf(SmsReceiveLogic.decodeFailureLine(SmsReceiveLogic.MISSING_ADDRESS, null)),
            result.failureLines,
        )
    }

    @Test
    fun nullBodyDropsWholeGroupWithMaskedLine() {
        val result = SmsReceiveLogic.group(
            listOf(PduPart(sender, "secret "), PduPart(sender, null), PduPart(other, "fine")),
        )
        assertEquals(listOf(ReceivedSms(other, "fine")), result.messages)
        val line = result.failureLines.single()
        assertEquals(SmsReceiveLogic.decodeFailureLine(SmsReceiveLogic.MISSING_BODY, sender), line)
        assertEquals(LogMask.tail3(sender), addressPart(line))
        assertFalse(line.contains(sender))
        assertFalse(line.contains("secret"))
    }

    @Test
    fun emptyBodyIsAllowed() {
        val result = SmsReceiveLogic.group(listOf(PduPart(sender, "")))
        assertEquals(listOf(ReceivedSms(sender, "")), result.messages)
        assertTrue(result.failureLines.isEmpty())
    }

    // ---- Branch table (1.4, 1.5, 1.6, 9.12) ----

    @Test
    fun branchTableCoversEveryCombination() {
        val bools = listOf(true, false)
        for (paused in listOf(true, false, null)) for (running in bools) for (attached in bools) {
            val expected = when {
                paused == true -> ReceiveBranch.PAUSED_TASK
                running && attached -> ReceiveBranch.MEMORY_QUEUE
                else -> ReceiveBranch.PENDING_INBOX
            }
            assertEquals(
                "paused=$paused running=$running attached=$attached",
                expected,
                SmsReceiveLogic.branch(paused, running, attached),
            )
        }
    }

    // ---- Refused Paused_Path_Task (9.13, 9.14, 14.13, 14.14) ----

    private data class Row(val sender: String, val marker: String, val receivedAt: Long)

    private class Harness {
        val rows = mutableListOf<Row>()
        val fieldCounts = mutableListOf<Int>()
        val logs = mutableListOf<String>()
        val check = StopKeywordCheck(readAsset = { assetText }, log = { logs.add(it) })
        private val sink = PendingStopSink { s, m, t ->
            // The sink signature takes exactly the 3 Pending_Stop_Record fields.
            fieldCounts.add(listOf<Any>(s, m, t).size)
            rows.add(Row(s, m, t))
        }
        val store = PendingStopStore(sink, check, log = { logs.add(it) })

        fun refuse(sender: String, body: String, at: Long): Boolean =
            SmsReceiveLogic.handleRefusedPausedTask(
                sender, body, at,
                matchesStop = check::matches,
                insertStop = store::insert,
                log = { logs.add(it) },
            )
    }

    @Test
    fun stopPleaseWritesOnePendingStopRowAndOneMaskedLine() {
        val h = Harness()
        val body = "STOP please"
        assertTrue(h.refuse(sender, body, 1_700_000_000_000L))

        assertEquals(listOf(Row(sender, "STOP", 1_700_000_000_000L)), h.rows)
        assertEquals(listOf(3), h.fieldCounts)
        assertEquals(1, h.logs.size)
        assertEquals(LogMask.tail3(sender), addressPart(h.logs.single()))
        assertBodyAbsent(h, body)
    }

    @Test
    fun helpWritesNoRowAndOneMaskedDropLine() {
        val h = Harness()
        val body = "HELP"
        assertFalse(h.refuse(sender, body, 1_700_000_000_000L))

        assertTrue(h.rows.isEmpty())
        assertEquals(listOf(SmsReceiveLogic.droppedWhilePausedLine(sender)), h.logs)
        assertEquals(LogMask.tail3(sender), addressPart(h.logs.single()))
        assertBodyAbsent(h, body)
    }

    private fun assertBodyAbsent(h: Harness, body: String) {
        h.rows.forEach {
            assertFalse(it.sender.contains(body))
            assertFalse(it.marker.contains(body))
        }
        h.logs.forEach {
            assertFalse("body leaked into log: $it", it.contains(body))
            assertFalse("full sender leaked into log: $it", it.contains(sender))
        }
    }

    /** The text after "from " up to the closing parenthesis of a receive or pending-stop line. */
    private fun addressPart(line: String): String =
        Regex("from ([^)]*)\\)").find(line)?.groupValues?.get(1)
            ?: error("no address part in: $line")

    companion object {
        private val assetText: String by lazy {
            val path = System.getProperty("lazarus.stopAliasesPath")
                ?: error("lazarus.stopAliasesPath not set; run via Gradle")
            File(path).readText(Charsets.UTF_8)
        }
    }
}
