package com.pengopal.aiusagetracker

import com.pengopal.aiusagetracker.sync.expiryCookies
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountsTest {
    @Test
    fun everyExpiryIsSecureSoPrefixedCookiesAreAccepted() {
        // Chromium silently drops a __Secure- cookie set without Secure, which left ChatGPT signed in.
        val all = expiryCookies("__Secure-next-auth.session-token", "chatgpt.com") + expiryCookies("sessionKey", "claude.ai")
        assertTrue(all.isNotEmpty())
        all.forEach { assertTrue(it, it.contains("; Secure")) }
        all.forEach { assertTrue(it, it.contains("Max-Age=0")) }
    }

    @Test
    fun hostPrefixedCookiesGetNoDomain() {
        val c = expiryCookies("__Host-session", "grok.com")
        assertEquals(1, c.size)
        assertTrue(c.none { it.contains("Domain=") })
    }

    @Test
    fun plainCookiesExpireWithAndWithoutDomain() {
        val c = expiryCookies("sso", "grok.com")
        assertEquals(2, c.size)
        assertTrue(c.any { it.contains("Domain=.grok.com") })
    }
}
