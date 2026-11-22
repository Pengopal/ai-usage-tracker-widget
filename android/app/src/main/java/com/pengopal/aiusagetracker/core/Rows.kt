package com.pengopal.aiusagetracker.core

import com.pengopal.aiusagetracker.data.Metric
import com.pengopal.aiusagetracker.data.Row
import com.pengopal.aiusagetracker.data.ServiceState
import com.pengopal.aiusagetracker.data.Settings

// Kotlin twin of core/src/providers.js (orderedIds, effectivePlan, buildRows).
// RowsTest runs core/test/fixtures/rows-cases.json against it, so the two stay
// in step.

/** The user's order: known ids once each, then any missing ones in catalog order. */
fun orderedIds(order: List<String>, catalog: Catalog): List<String> {
    val picked = order.filter { catalog[it] != null }.distinct()
    return picked + catalog.ids.filter { it !in picked }
}

data class EffectivePlan(val key: String, val label: String?, val metrics: List<String>)

fun effectivePlan(provider: Provider, service: ServiceState?, chosen: String?): EffectivePlan {
    val plan = chosen?.takeIf { it != "auto" }?.let { provider.plans[it] }
    if (plan != null) return EffectivePlan(chosen!!, plan.label, plan.metrics)
    val detected = service?.plan?.let { provider.plans[it] }
    return EffectivePlan("auto", detected?.label, provider.metrics.keys.toList())
}

fun buildRows(services: Map<String, ServiceState>, settings: Settings, catalog: Catalog): List<Row> =
    orderedIds(settings.order, catalog)
        .filter { settings.provider(it).enabled }
        .map { id ->
            val p = catalog[id]!!
            val s = services[id] ?: ServiceState()
            val plan = effectivePlan(p, s, settings.provider(id).plan)
            Row(
                id = id,
                name = p.name,
                logo = p.logo,
                plan = plan.label,
                connected = s.connected,
                error = s.error,
                lastSync = s.lastSync,
                metrics = plan.metrics.mapNotNull { m ->
                    val w = s.windows[m] ?: return@mapNotNull null
                    Metric("$id.$m", p.metrics[m] ?: m, w.pct, w.reset)
                },
            )
        }
