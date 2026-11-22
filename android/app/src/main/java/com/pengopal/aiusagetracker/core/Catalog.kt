package com.pengopal.aiusagetracker.core

import android.content.Context
import org.json.JSONObject

// The provider catalog, read from core/src/catalog.json (shipped in the APK's
// assets by the copyCore Gradle task). Same file the desktop app uses.

data class Plan(val label: String, val metrics: List<String>, val hidden: Boolean)

data class Provider(
    val id: String,
    val name: String,
    val logo: String,
    val url: String,
    val home: String,
    val loginUrl: String,
    val metrics: Map<String, String>, // metric id -> label, in display order
    val plans: Map<String, Plan>,
) {
    val host: String get() = android.net.Uri.parse(home).host ?: ""

    /** Plan picker choices: Auto first, then the visible plans. */
    fun planOptions(): List<Pair<String, String>> =
        listOf("auto" to "Auto-detect") + plans.filter { !it.value.hidden }.map { it.key to it.value.label }
}

class Catalog(val providers: List<Provider>) {
    val ids: List<String> = providers.map { it.id }
    operator fun get(id: String): Provider? = providers.firstOrNull { it.id == id }

    companion object {
        fun parse(json: String): Catalog {
            val root = JSONObject(json)
            val list = root.keys().asSequence().map { id ->
                val p = root.getJSONObject(id)
                val m = p.getJSONObject("metrics")
                val pl = p.getJSONObject("plans")
                Provider(
                    id = id,
                    name = p.getString("name"),
                    logo = p.getString("logo"),
                    url = p.getString("url"),
                    home = p.getString("home"),
                    loginUrl = p.getString("loginUrl"),
                    metrics = linkedMapOf<String, String>().apply { m.keys().forEach { put(it, m.getString(it)) } },
                    plans = linkedMapOf<String, Plan>().apply {
                        pl.keys().forEach { key ->
                            val o = pl.getJSONObject(key)
                            val ms = o.getJSONArray("metrics")
                            put(key, Plan(o.getString("label"), List(ms.length()) { ms.getString(it) }, o.optBoolean("hidden", false)))
                        }
                    },
                )
            }.toList()
            return Catalog(list)
        }

        @Volatile private var cached: Catalog? = null

        fun load(context: Context): Catalog = cached ?: synchronized(this) {
            cached ?: parse(context.assets.open("core/catalog.json").bufferedReader().use { it.readText() }).also { cached = it }
        }
    }
}
