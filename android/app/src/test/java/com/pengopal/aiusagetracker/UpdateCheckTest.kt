package com.pengopal.aiusagetracker

import android.content.pm.PackageInstaller
import com.pengopal.aiusagetracker.update.Release
import com.pengopal.aiusagetracker.update.UpdateState
import com.pengopal.aiusagetracker.update.installResultState
import com.pengopal.aiusagetracker.update.isNewer
import com.pengopal.aiusagetracker.update.parseRelease
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateCheckTest {
    @Test
    fun compare() {
        assertTrue(isNewer("1.10.0", "1.9.0"))
        assertTrue(isNewer("v1.3.1", "1.3.0"))
        assertTrue(isNewer("2.0", "1.99.99"))
        assertFalse(isNewer("1.3.0", "1.3.0"))
        assertFalse(isNewer("v1.2.9", "1.3.0"))
        assertFalse(isNewer("garbage", "1.3.0"))
    }

    @Test
    fun picksTheApkAsset() {
        val r = parseRelease(
            """{"tag_name":"v1.4.0","html_url":"https://github.com/x/y/releases/tag/v1.4.0","assets":[
              {"name":"AI-Usage-Tracker-Setup-1.4.0.exe","browser_download_url":"https://e/exe","size":1},
              {"name":"AI-Usage-Tracker-1.4.0.apk","browser_download_url":"https://e/apk","size":42}]}""",
        )
        assertEquals("1.4.0", r.version)
        assertEquals("https://e/apk", r.apkUrl)
        assertEquals(42L, r.apkSize)
    }

    @Test
    fun noApkAsset() {
        val r = parseRelease("""{"tag_name":"v1.4.0","html_url":"https://h","assets":[{"name":"latest.yml","browser_download_url":"u","size":1}]}""")
        assertNull(r.apkUrl)
    }

    @Test
    fun installResult() {
        val rel = Release("1.4.0", "https://e/apk", 42, "https://e/page")
        // A confirm dialog Android may block from the background stays one tap away instead of hanging on "Installing…".
        assertEquals(UpdateState.NeedsConfirm(rel), installResultState(PackageInstaller.STATUS_PENDING_USER_ACTION, null, rel))
        assertEquals(UpdateState.Idle, installResultState(PackageInstaller.STATUS_SUCCESS, null, rel))
        assertEquals(UpdateState.Failed("Install cancelled"), installResultState(PackageInstaller.STATUS_FAILURE_ABORTED, null, rel))
        assertEquals(UpdateState.Failed("Conflict"), installResultState(PackageInstaller.STATUS_FAILURE_CONFLICT, "Conflict", rel))
    }
}
