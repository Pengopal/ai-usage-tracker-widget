package com.pengopal.aiusagetracker.sync

import com.pengopal.aiusagetracker.data.ServiceState
import com.pengopal.aiusagetracker.data.windowsFromJson
import org.json.JSONObject

/**
 * Folds one provider's sync into what is stored, like the desktop's merge():
 * a failed read or a reader error keeps the last good numbers and only sets the
 * error; signing out clears the provider.
 */
fun merge(prev: ServiceState, result: Result<JSONObject>, now: Long): ServiceState {
    val value = result.getOrElse { return prev.copy(error = it.message ?: "Sync failed") }
    if (!value.optBoolean("connected", false)) return ServiceState()
    if (value.has("error") && !value.isNull("error")) return prev.copy(connected = true, error = value.getString("error"))
    return ServiceState(
        connected = true,
        windows = windowsFromJson(value.optJSONObject("windows")),
        plan = if (value.has("plan") && !value.isNull("plan")) value.getString("plan") else prev.plan,
        error = null,
        lastSync = now,
    )
}

/**
 * Runs one provider read. A timeout becomes a plain message the widget can
 * show; any other cancellation (WorkManager stopping the worker) is rethrown
 * so it is never stored as a "Sync problem".
 */
suspend fun <T> readResult(host: String, block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (e: kotlinx.coroutines.TimeoutCancellationException) {
    Result.failure(Exception("Timed out loading $host"))
} catch (e: kotlinx.coroutines.CancellationException) {
    throw e
} catch (e: Exception) {
    Result.failure(e)
}
