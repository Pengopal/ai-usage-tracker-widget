package com.pengopal.aiusagetracker

import com.pengopal.aiusagetracker.core.Level
import com.pengopal.aiusagetracker.core.formatDuration
import com.pengopal.aiusagetracker.core.level
import com.pengopal.aiusagetracker.core.resetText
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

// Mirrors the desktop widget's formatDuration / resetText / level.
class FormatTest {
    private val min = 60_000L

    @Test
    fun durations() {
        assertEquals("2h 12m", formatDuration((2 * 60 + 12) * min))
        assertEquals("3d 9h", formatDuration((3 * 1440 + 9 * 60 + 5) * min))
        assertEquals("1m", formatDuration(30_000))
        assertEquals("0m", formatDuration(-5))
    }

    @Test
    fun resetLine() {
        val now = 1_700_000_000_000L
        assertEquals("Resets in 2h 12m", resetText(Instant.ofEpochMilli(now + 132 * min).toString(), now))
        assertEquals("Resetting…", resetText(Instant.ofEpochMilli(now - min).toString(), now))
        assertEquals("", resetText(null, now))
        assertEquals("", resetText("not a date", now))
    }

    @Test
    fun colourLevels() {
        assertEquals(Level.OK, level(69.9))
        assertEquals(Level.WARN, level(70.0))
        assertEquals(Level.DANGER, level(90.0))
    }
}
