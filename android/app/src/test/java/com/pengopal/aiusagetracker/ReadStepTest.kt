package com.pengopal.aiusagetracker

import com.pengopal.aiusagetracker.sync.ReadStep
import com.pengopal.aiusagetracker.sync.readStep
import org.junit.Assert.assertEquals
import org.junit.Test

class ReadStepTest {
    private val host = "claude.ai"

    @Test
    fun startsTheReaderAsSoonAsAPageOnTheSiteIsCommitted() {
        // No onPageFinished needed: a committed page on the provider's origin is enough.
        assertEquals(ReadStep.Inject, readStep("https://claude.ai/settings/usage", host, started = false, result = null))
    }

    @Test
    fun waitsWhileTheReaderRuns() {
        assertEquals(ReadStep.Wait, readStep("https://claude.ai/settings/usage", host, started = true, result = null))
    }

    @Test
    fun returnsTheResultOnceThereIsOne() {
        assertEquals(ReadStep.Done("{\"connected\":true}"), readStep("https://claude.ai/", host, started = true, result = "{\"connected\":true}"))
    }

    @Test
    fun reinjectsAfterANavigationDroppedTheReader() {
        // A new document on the same site has no reader yet.
        assertEquals(ReadStep.Inject, readStep("https://claude.ai/new", host, started = false, result = null))
    }

    @Test
    fun waitsOffTheSiteAndBeforeAnyPage() {
        assertEquals(ReadStep.Wait, readStep("https://accounts.google.com/signin", host, started = false, result = null))
        assertEquals(ReadStep.Wait, readStep("about:blank", host, started = false, result = null))
        assertEquals(ReadStep.Wait, readStep(null, host, started = false, result = null))
    }
}
