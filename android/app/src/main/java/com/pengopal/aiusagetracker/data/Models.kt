package com.pengopal.aiusagetracker.data

import org.json.JSONObject

// The same shapes the desktop app stores, so readings mean the same thing on
// every platform.

data class Window(val pct: Double, val reset: String?)

data class ServiceState(
    val connected: Boolean = false,
    val windows: Map<String, Window> = emptyMap(),
    val plan: String? = null,
    val error: String? = null,
    val lastSync: Long? = null,
)

data class ProviderSetting(val enabled: Boolean = true, val plan: String = "auto")

data class Settings(
    val order: List<String> = emptyList(),
    val providers: Map<String, ProviderSetting> = emptyMap(),
) {
    fun provider(id: String) = providers[id] ?: ProviderSetting()
}

data class Metric(val id: String, val label: String, val pct: Double, val reset: String?)

data class Row(
    val id: String,
    val name: String,
    val logo: String,
    val plan: String?,
    val connected: Boolean,
    val error: String?,
    val lastSync: Long?,
    val metrics: List<Metric>,
)

data class Snapshot(
    val services: Map<String, ServiceState> = emptyMap(),
    val settings: Settings = Settings(),
    val lastSync: Long? = null,
)

// ---------- JSON ----------

private fun JSONObject.stringOrNull(key: String) = if (has(key) && !isNull(key)) getString(key) else null

fun windowsFromJson(o: JSONObject?): Map<String, Window> {
    if (o == null) return emptyMap()
    return o.keys().asSequence().mapNotNull { key ->
        val w = o.optJSONObject(key) ?: return@mapNotNull null
        if (!w.has("pct") || w.isNull("pct")) return@mapNotNull null
        key to Window(w.getDouble("pct"), w.stringOrNull("reset"))
    }.toMap()
}

fun serviceFromJson(o: JSONObject) = ServiceState(
    connected = o.optBoolean("connected", false),
    windows = windowsFromJson(o.optJSONObject("windows")),
    plan = o.stringOrNull("plan"),
    error = o.stringOrNull("error"),
    lastSync = if (o.has("lastSync") && !o.isNull("lastSync")) o.optLong("lastSync") else null,
)

fun servicesFromJson(o: JSONObject): Map<String, ServiceState> =
    o.keys().asSequence().associateWith { serviceFromJson(o.getJSONObject(it)) }

fun ServiceState.toJson(): JSONObject = JSONObject().apply {
    put("connected", connected)
    put("windows", JSONObject().apply {
        windows.forEach { (k, w) -> put(k, JSONObject().put("pct", w.pct).put("reset", w.reset ?: JSONObject.NULL)) }
    })
    put("plan", plan ?: JSONObject.NULL)
    put("error", error ?: JSONObject.NULL)
    put("lastSync", lastSync ?: JSONObject.NULL)
}

fun Settings.toJson(): JSONObject = JSONObject().apply {
    put("order", org.json.JSONArray(order))
    put("providers", JSONObject().apply {
        providers.forEach { (id, p) -> put(id, JSONObject().put("enabled", p.enabled).put("plan", p.plan)) }
    })
}

fun settingsFromJson(o: JSONObject?): Settings {
    if (o == null) return Settings()
    val order = o.optJSONArray("order")?.let { a -> List(a.length()) { a.getString(it) } } ?: emptyList()
    val p = o.optJSONObject("providers")
    val providers = p?.keys()?.asSequence()?.associateWith {
        val s = p.getJSONObject(it)
        ProviderSetting(s.optBoolean("enabled", true), s.optString("plan", "auto"))
    } ?: emptyMap()
    return Settings(order, providers)
}

fun Snapshot.toJson(): JSONObject = JSONObject().apply {
    put("services", JSONObject().apply { services.forEach { (id, s) -> put(id, s.toJson()) } })
    put("settings", settings.toJson())
    put("lastSync", lastSync ?: JSONObject.NULL)
}

fun snapshotFromJson(o: JSONObject) = Snapshot(
    services = o.optJSONObject("services")?.let(::servicesFromJson) ?: emptyMap(),
    settings = settingsFromJson(o.optJSONObject("settings")),
    lastSync = if (o.has("lastSync") && !o.isNull("lastSync")) o.optLong("lastSync") else null,
)
