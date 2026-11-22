package com.pengopal.aiusagetracker

import com.pengopal.aiusagetracker.data.ServiceState
import com.pengopal.aiusagetracker.data.Window
import com.pengopal.aiusagetracker.sync.merge
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

// Same rules as the desktop's merge(): problems keep the last good numbers.
class MergeTest {
    private val prev = ServiceState(connected = true, windows = mapOf("weekly" to Window(40.0, null)), plan = "pro", lastSync = 1)

    @Test
    fun failureKeepsNumbersAndSetsError() {
        val out = merge(prev, Result.failure(RuntimeException("offline")), 5)
        assertEquals(prev.windows, out.windows)
        assertEquals("offline", out.error)
    }

    @Test
    fun signedOutClearsTheService() {
        assertEquals(ServiceState(), merge(prev, Result.success(JSONObject("""{"connected":false}""")), 5))
    }

    @Test
    fun readerErrorKeepsNumbers() {
        val out = merge(prev, Result.success(JSONObject("""{"connected":true,"error":"usage HTTP 500"}""")), 5)
        assertEquals(prev.windows, out.windows)
        assertEquals("usage HTTP 500", out.error)
    }

    @Test
    fun goodReadReplacesWindowsAndKeepsKnownPlan() {
        val out = merge(
            prev,
            Result.success(JSONObject("""{"connected":true,"windows":{"session":{"pct":12.5,"reset":"2026-01-01T00:00:00Z"}}}""")),
            9,
        )
        assertEquals(mapOf("session" to Window(12.5, "2026-01-01T00:00:00Z")), out.windows)
        assertEquals("pro", out.plan)
        assertEquals(9L, out.lastSync)
        assertEquals(null, out.error)
    }
}
