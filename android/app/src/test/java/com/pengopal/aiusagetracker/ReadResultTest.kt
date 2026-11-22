package com.pengopal.aiusagetracker

import com.pengopal.aiusagetracker.sync.readResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReadResultTest {
    @Test
    fun timeoutBecomesAPlainMessage() = runBlocking {
        val r = readResult("chatgpt.com") { withTimeout(1) { delay(1_000) } }
        assertEquals("Timed out loading chatgpt.com", r.exceptionOrNull()?.message)
    }

    @Test
    fun cancellationIsNotStoredAsASyncProblem() = runBlocking {
        var rethrown = false
        try {
            readResult("claude.ai") { throw CancellationException("Job was cancelled") }
        } catch (e: CancellationException) {
            rethrown = true
        }
        assertTrue(rethrown)
    }

    @Test
    fun otherFailuresAreKept() = runBlocking {
        val r = readResult("grok.com") { error("net::ERR_NAME_NOT_RESOLVED") }
        assertEquals("net::ERR_NAME_NOT_RESOLVED", r.exceptionOrNull()?.message)
    }
}
