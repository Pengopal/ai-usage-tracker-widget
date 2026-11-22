package com.pengopal.aiusagetracker

import com.pengopal.aiusagetracker.core.Catalog
import com.pengopal.aiusagetracker.core.buildRows
import com.pengopal.aiusagetracker.core.orderedIds
import com.pengopal.aiusagetracker.data.ProviderSetting
import com.pengopal.aiusagetracker.data.Settings
import com.pengopal.aiusagetracker.data.servicesFromJson
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

// Runs the same cases as core/test/providers.test.js, so Android builds the
// rows exactly like the desktop app.
class RowsTest {
    private val catalog = Catalog.parse(File("../../core/src/catalog.json").readText())
    private val fixture = JSONObject(File("../../core/test/fixtures/rows-cases.json").readText())

    private fun JSONArray.strings() = List(length()) { getString(it) }

    @Test
    fun sharedCases() {
        val services = servicesFromJson(fixture.getJSONObject("services"))
        val cases = fixture.getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val p = c.getJSONObject("providers")
            val settings = Settings(
                order = c.optJSONArray("order")?.strings() ?: emptyList(),
                providers = p.keys().asSequence().associateWith {
                    val o = p.getJSONObject(it)
                    ProviderSetting(o.optBoolean("enabled", true), o.optString("plan", "auto"))
                },
            )
            val actual = buildRows(services, settings, catalog).map {
                listOf(it.id, it.plan, it.connected, it.metrics.map { m -> m.label })
            }
            val e = c.getJSONArray("expect")
            val expected = List(e.length()) {
                val o = e.getJSONObject(it)
                listOf(
                    o.getString("id"),
                    if (o.isNull("plan")) null else o.getString("plan"),
                    o.getBoolean("connected"),
                    o.getJSONArray("metrics").strings(),
                )
            }
            assertEquals(c.getString("name"), expected, actual)
        }
    }

    @Test
    fun orderKeepsEachProviderOnce() {
        assertEquals(listOf("grok", "claude", "openai"), orderedIds(listOf("grok", "gemini", "grok"), catalog))
        assertEquals(listOf("claude", "openai", "grok"), orderedIds(emptyList(), catalog))
    }

    @Test
    fun planPickerOffersAutoFirstAndNoHiddenPlans() {
        val keys = catalog["claude"]!!.planOptions().map { it.first }
        assertEquals("auto", keys.first())
        assertTrue("max20" in keys)
        assertTrue("max" !in keys)
    }
}
