package com.pengopal.aiusagetracker.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pengopal.aiusagetracker.core.level
import com.pengopal.aiusagetracker.core.resetText
import com.pengopal.aiusagetracker.data.Metric
import com.pengopal.aiusagetracker.data.Row as UsageRow

/** The desktop bar view in Compose: same layout as the home-screen widget. */
@Composable
fun UsageBars(rows: List<UsageRow>, now: Long, onSignIn: (String) -> Unit) {
    Column {
        rows.forEachIndexed { i, row ->
            if (i > 0) Box(Modifier.padding(vertical = 8.dp).fillMaxWidth().height(1.dp).background(Palette.line))
            ProviderBars(row, now, onSignIn)
        }
    }
}

@Composable
private fun ProviderBars(row: UsageRow, now: Long, onSignIn: (String) -> Unit) {
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(painterResource(Palette.logo(row.logo)), null, tint = Palette.logoTint(row.id), modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(7.dp))
            Text(row.name, color = Palette.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            row.plan?.let {
                Spacer(Modifier.width(7.dp))
                PlanChip(it)
            }
        }
        when {
            !row.connected -> Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Not connected", color = Palette.muted, fontSize = 13.sp, modifier = Modifier.weight(1f))
                Text(
                    "Sign in",
                    color = Palette.accent,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickableNoRipple { onSignIn(row.id) }.padding(4.dp),
                )
            }
            row.metrics.isEmpty() && row.error == null ->
                Text("No limits reported for this plan yet", color = Palette.faint, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
            else -> row.metrics.forEach { MetricLine(it, now) }
        }
        if (row.connected && row.error != null) {
            Text("Sync problem: ${row.error}", color = Palette.warn, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 3.dp))
        }
    }
}

@Composable
fun PlanChip(label: String) {
    Text(
        label.uppercase(),
        color = Palette.muted,
        fontSize = 10.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.4.sp,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Palette.track).padding(horizontal = 6.dp, vertical = 1.dp),
    )
}

@Composable
private fun MetricLine(m: Metric, now: Long) {
    val lvl = level(m.pct)
    Column(Modifier.padding(top = 6.dp)) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(m.label, color = Palette.muted, fontSize = 13.sp)
            Text(
                resetText(m.reset, now),
                color = Palette.faint,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text("${Math.round(m.pct)}%", color = Palette.pctText(lvl), fontSize = 13.5.sp, fontWeight = FontWeight.Bold)
        }
        Box(Modifier.padding(top = 4.dp).fillMaxWidth().height(3.dp).clip(RoundedCornerShape(99.dp)).background(Palette.track)) {
            Box(
                Modifier.fillMaxWidth((m.pct / 100.0).toFloat().coerceIn(0f, 1f)).height(3.dp)
                    .clip(RoundedCornerShape(99.dp)).background(Palette.of(lvl)),
            )
        }
    }
}
