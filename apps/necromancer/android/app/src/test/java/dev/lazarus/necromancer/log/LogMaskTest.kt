package dev.lazarus.necromancer.log

import org.junit.Assert.assertEquals
import org.junit.Test

/** Requirement 14.14: logcat lines keep only the last 3 characters of a sender. */
class LogMaskTest {
    @Test
    fun emptyBecomesSingleMark() {
        assertEquals("•", LogMask.tail3(""))
    }

    @Test
    fun oneToThreeCharactersAreKept() {
        assertEquals("7", LogMask.tail3("7"))
        assertEquals("67", LogMask.tail3("67"))
        assertEquals("567", LogMask.tail3("567"))
    }

    @Test
    fun longNumberKeepsLastThree() {
        assertEquals("••••••••••123", LogMask.tail3("+923001234123"))
    }

    @Test
    fun alphanumericIdKeepsLastThree() {
        assertEquals("•••••INK", LogMask.tail3("JAZZ-INK"))
    }
}
