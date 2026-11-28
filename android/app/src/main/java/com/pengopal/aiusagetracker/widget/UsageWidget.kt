package com.pengopal.aiusagetracker.widget

import android.content.Context
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.ActionParameters
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.itemsIndexed
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.pengopal.aiusagetracker.R
import com.pengopal.aiusagetracker.core.Catalog
import com.pengopal.aiusagetracker.core.buildRows
import com.pengopal.aiusagetracker.core.level
import com.pengopal.aiusagetracker.core.resetText
import com.pengopal.aiusagetracker.data.Metric
import com.pengopal.aiusagetracker.data.Row as UsageRow
import com.pengopal.aiusagetracker.data.UsageStore
import com.pengopal.aiusagetracker.sync.Sync
import com.pengopal.aiusagetracker.ui.MainActivity
import com.pengopal.aiusagetracker.ui.Palette
import java.util.Date

/** Home-screen widget in the desktop bar style: one line per limit, thin bar under it. */
class UsageWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val store = UsageStore.get(context)
        val catalog = Catalog.load(context)
        val timeFormat = DateFormat.getTimeFormat(context)
        val widgetRefreshPending = Sync.widgetRefreshPending(context)
        provideContent {
            val snap by store.state.collectAsState()
            val syncing by Sync.running.collectAsState()
            val refreshPending by widgetRefreshPending.collectAsState(initial = false)
            val now = System.currentTimeMillis()
            WidgetContent(
                rows = buildRows(snap.services, snap.settings, catalog),
                updated = snap.lastSync?.let { timeFormat.format(Date(it)) },
                syncing = syncing,
                refreshPending = refreshPending,
                now = now,
            )
        }
    }

    companion object {
        suspend fun refresh(context: Context) = UsageWidget().updateAll(context)
    }
}

class UsageWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = UsageWidget()

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        Sync.schedule(context)
        Sync.runNow(context)
    }
}

class RefreshAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        Sync.refreshFromWidget(context)
        UsageWidget().update(context, glanceId)
    }
}

private fun color(c: androidx.compose.ui.graphics.Color) = ColorProvider(c)

private fun style(c: androidx.compose.ui.graphics.Color, size: Float, weight: FontWeight = FontWeight.Normal) =
    TextStyle(color = color(c), fontSize = size.sp, fontWeight = weight)

@Composable
private fun WidgetContent(rows: List<UsageRow>, updated: String?, syncing: Boolean, refreshPending: Boolean, now: Long) {
    val openApp = actionStartActivity<MainActivity>()
    Column(
        modifier = GlanceModifier.fillMaxSize().background(color(Palette.bg)).cornerRadius(16.dp)
            .padding(horizontal = 12.dp, vertical = 8.dp).clickable(openApp),
    ) {
        Row(modifier = GlanceModifier.fillMaxWidth().padding(bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            val anyConnected = rows.any { it.connected }
            Box(
                modifier = GlanceModifier.size(6.dp).cornerRadius(3.dp)
                    .background(color(if (syncing || refreshPending) Palette.accent else if (anyConnected) Palette.ok else Palette.faint)),
            ) {}
            Spacer(GlanceModifier.width(6.dp))
            Text("Usage", style = style(Palette.text, 13f, FontWeight.Bold))
            Spacer(GlanceModifier.width(6.dp))
            val status = when {
                syncing -> "Syncing…"
                refreshPending -> "Refresh queued…"
                else -> updated.orEmpty()
            }
            Text(status, style = style(Palette.faint, 11f), maxLines = 1)
            Spacer(GlanceModifier.defaultWeight())
            Image(
                provider = ImageProvider(R.drawable.ic_refresh),
                contentDescription = "Refresh",
                colorFilter = ColorFilter.tint(color(Palette.faint)),
                modifier = GlanceModifier.size(26.dp).padding(5.dp).clickable(actionRunCallback<RefreshAction>()),
            )
        }
        when {
            rows.isEmpty() -> Note("All providers are hidden. Turn one on in the app.")
            rows.none { it.connected } -> Note("Open the app to sign in to Claude, ChatGPT or Grok.")
            else -> LazyColumn(modifier = GlanceModifier.fillMaxSize()) {
                itemsIndexed(rows) { index, row -> ProviderBlock(row, now, first = index == 0) }
            }
        }
    }
}

@Composable
private fun Note(text: String) {
    Text(text, style = style(Palette.muted, 12f), modifier = GlanceModifier.padding(top = 6.dp))
}

@Composable
private fun ProviderBlock(row: UsageRow, now: Long, first: Boolean) {
    Column(modifier = GlanceModifier.fillMaxWidth()) {
        if (!first) {
            Spacer(GlanceModifier.height(6.dp))
            Box(modifier = GlanceModifier.fillMaxWidth().height(1.dp).background(color(Palette.line))) {}
        }
        Spacer(GlanceModifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Image(
                provider = ImageProvider(Palette.logo(row.logo)),
                contentDescription = null,
                colorFilter = ColorFilter.tint(color(Palette.logoTint(row.id))),
                modifier = GlanceModifier.size(13.dp),
            )
            Spacer(GlanceModifier.width(6.dp))
            Text(row.name, style = style(Palette.text, 12.5f, FontWeight.Bold))
            if (row.plan != null) {
                Spacer(GlanceModifier.width(6.dp))
                Text(
                    row.plan.uppercase(),
                    style = style(Palette.muted, 9.5f, FontWeight.Bold),
                    modifier = GlanceModifier.background(color(Palette.raise)).cornerRadius(4.dp).padding(horizontal = 5.dp, vertical = 1.dp),
                )
            }
        }
        when {
            !row.connected -> Row(modifier = GlanceModifier.fillMaxWidth().padding(top = 3.dp)) {
                Text("Not connected", style = style(Palette.muted, 12f))
                Spacer(GlanceModifier.defaultWeight())
                Text("Sign in", style = style(Palette.accent, 12f, FontWeight.Bold))
            }
            row.metrics.isEmpty() && row.error == null -> Text(
                "No limits reported for this plan yet",
                style = style(Palette.faint, 11f),
                modifier = GlanceModifier.padding(top = 3.dp),
            )
            else -> row.metrics.forEach { MetricLine(it, now) }
        }
        if (row.connected && row.error != null) {
            Text("Sync problem: ${row.error}", style = style(Palette.warn, 11f), maxLines = 1, modifier = GlanceModifier.padding(top = 2.dp))
        }
    }
}

@Composable
private fun MetricLine(m: Metric, now: Long) {
    val lvl = level(m.pct)
    Column(modifier = GlanceModifier.fillMaxWidth().padding(top = 4.dp)) {
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(m.label, style = style(Palette.muted, 12f))
            Spacer(GlanceModifier.width(8.dp))
            Text(resetText(m.reset, now), style = style(Palette.faint, 11f), maxLines = 1, modifier = GlanceModifier.defaultWeight())
            Text("${Math.round(m.pct)}%", style = style(Palette.pctText(lvl), 12.5f, FontWeight.Bold))
        }
        Spacer(GlanceModifier.height(3.dp))
        LinearProgressIndicator(
            progress = (m.pct / 100.0).toFloat().coerceIn(0f, 1f),
            modifier = GlanceModifier.fillMaxWidth().height(3.dp),
            color = color(Palette.of(lvl)),
            backgroundColor = color(Palette.track),
        )
    }
}
