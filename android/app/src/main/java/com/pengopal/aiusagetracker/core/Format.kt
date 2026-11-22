package com.pengopal.aiusagetracker.core

import java.time.Instant

// Same wording and thresholds as the desktop widget (desktop/src/renderer/app.js).

enum class Level { OK, WARN, DANGER }

fun level(pct: Double): Level = when {
    pct >= 90 -> Level.DANGER
    pct >= 70 -> Level.WARN
    else -> Level.OK
}

fun formatDuration(ms: Long): String {
    val totalMin = if (ms <= 0) 0L else (ms + 59_999L) / 60_000L // whole minutes, rounded up
    val d = totalMin / 1440
    val h = (totalMin % 1440) / 60
    val m = totalMin % 60
    return when {
        d > 0 -> "${d}d ${h}h"
        h > 0 -> "${h}h ${m}m"
        else -> "${m}m"
    }
}

/** "Resets in 2h 12m", "Resetting…" once the time has passed, or "" when unknown. */
fun resetText(reset: String?, now: Long): String {
    val at = reset?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: return ""
    val left = at - now
    return if (left > 0) "Resets in ${formatDuration(left)}" else "Resetting…"
}
