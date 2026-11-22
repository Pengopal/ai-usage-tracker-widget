package com.pengopal.aiusagetracker.update

import org.json.JSONObject

// Pure parts of the self-updater, shared by both flavours so they're testable.

const val RELEASES_API = "https://api.github.com/repos/Pengopal/ai-usage-tracker-widget/releases/latest"
const val RELEASES_PAGE = "https://github.com/Pengopal/ai-usage-tracker-widget/releases/latest"

data class Release(val version: String, val apkUrl: String?, val apkSize: Long, val pageUrl: String)

sealed interface UpdateState {
    data object Unsupported : UpdateState // play flavour: the Store updates the app
    data object Idle : UpdateState
    data object Checking : UpdateState
    data object Current : UpdateState
    data class Available(val release: Release) : UpdateState
    data class Downloading(val release: Release, val progress: Float) : UpdateState
    data class Installing(val release: Release) : UpdateState
    /** Android's install dialog is waiting; the app shows it when it is in front. */
    data class NeedsConfirm(val release: Release) : UpdateState
    data class Failed(val message: String) : UpdateState
}

/** The GitHub "latest release" response: its version and the .apk asset, if any. */
fun parseRelease(json: String): Release {
    val o = JSONObject(json)
    val assets = o.optJSONArray("assets")
    val apk = (0 until (assets?.length() ?: 0)).map { assets!!.getJSONObject(it) }
        .firstOrNull { it.optString("name").endsWith(".apk", ignoreCase = true) }
    return Release(
        version = o.optString("tag_name").removePrefix("v"),
        apkUrl = apk?.optString("browser_download_url"),
        apkSize = apk?.optLong("size") ?: 0L,
        pageUrl = o.optString("html_url", RELEASES_PAGE),
    )
}

private fun parts(v: String): List<Int>? =
    v.trim().removePrefix("v").split(".").map { it.toIntOrNull() ?: return null }

/** True when [remote] is a later version than [local] (1.10.0 > 1.9.0). */
fun isNewer(remote: String, local: String): Boolean {
    val r = parts(remote) ?: return false
    val l = parts(local) ?: return false
    for (i in 0 until maxOf(r.size, l.size)) {
        val a = r.getOrElse(i) { 0 }
        val b = l.getOrElse(i) { 0 }
        if (a != b) return a > b
    }
    return false
}

/** The state after Android's package installer reports [status] for [release]. */
fun installResultState(status: Int, message: String?, release: Release): UpdateState = when (status) {
    android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION -> UpdateState.NeedsConfirm(release)
    android.content.pm.PackageInstaller.STATUS_SUCCESS -> UpdateState.Idle
    else -> UpdateState.Failed(message ?: "Install cancelled")
}
