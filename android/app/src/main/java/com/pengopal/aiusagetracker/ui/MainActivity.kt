package com.pengopal.aiusagetracker.ui

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.format.DateFormat
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pengopal.aiusagetracker.BuildConfig
import com.pengopal.aiusagetracker.R
import com.pengopal.aiusagetracker.core.Catalog
import com.pengopal.aiusagetracker.core.Provider
import com.pengopal.aiusagetracker.core.buildRows
import com.pengopal.aiusagetracker.core.orderedIds
import com.pengopal.aiusagetracker.data.Snapshot
import com.pengopal.aiusagetracker.data.UsageStore
import com.pengopal.aiusagetracker.sync.Accounts
import com.pengopal.aiusagetracker.sync.Sync
import com.pengopal.aiusagetracker.update.UpdateState
import com.pengopal.aiusagetracker.update.Updates
import com.pengopal.aiusagetracker.widget.UsageWidget
import com.pengopal.aiusagetracker.widget.UsageWidgetReceiver
import kotlinx.coroutines.launch
import java.util.Date

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Light status-bar icons on the dark background.
        enableEdgeToEdge(SystemBarStyle.dark(android.graphics.Color.TRANSPARENT), SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Palette.accent,
                    onPrimary = Palette.onAccent,
                    background = Palette.bg,
                    surface = Palette.raise,
                    onSurface = Palette.text,
                ),
            ) { Screen() }
        }
    }

    override fun onResume() {
        super.onResume()
        Sync.runNow(this)
    }
}

fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier = composed {
    clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClick)
}

@Composable
private fun Screen() {
    val context = LocalContext.current
    val store = remember { UsageStore.get(context) }
    val catalog = remember { Catalog.load(context) }
    val snap by store.state.collectAsStateWithLifecycle()
    val syncing by Sync.running.collectAsStateWithLifecycle()
    val signIn = { id: String -> context.startActivity(LoginActivity.intent(context, id)) }

    Column(
        Modifier.fillMaxSize().background(Palette.bg).safeDrawingPadding().verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Header(snap, syncing) { Sync.runNow(context) }
        Card { UsageBars(buildRows(snap.services, snap.settings, catalog), System.currentTimeMillis(), signIn) }

        Section("Providers")
        Card {
            val ids = orderedIds(snap.settings.order, catalog)
            ids.forEachIndexed { i, id ->
                if (i > 0) Box(Modifier.padding(vertical = 4.dp).fillMaxWidth().height(1.dp).background(Palette.line))
                ProviderSettings(catalog[id]!!, snap, index = i, count = ids.size, onSignIn = signIn, onMove = { delta ->
                    val list = ids.toMutableList()
                    val to = (i + delta).coerceIn(0, list.lastIndex)
                    list.add(to, list.removeAt(i))
                    store.setOrder(list)
                })
            }
        }
        Hint(
            "Sign in opens the real login page and closes by itself once you're in. \"Auto\" shows every limit " +
                "your account reports; pick your plan to show only that plan's limits.",
        )

        Section("Widget")
        Card { WidgetSection() }

        Section("About")
        Card { AboutSection() }
        Spacer(Modifier.height(24.dp))
    }
    LaunchedEffect(snap.settings) { UsageWidget.refresh(context) }
}

@Composable
private fun Header(snap: Snapshot, syncing: Boolean, onRefresh: () -> Unit) {
    val context = LocalContext.current
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).clip(RoundedCornerShape(50)).background(if (syncing) Palette.accent else Palette.ok))
        Spacer(Modifier.width(8.dp))
        Text("Usage", color = Palette.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.width(8.dp))
        Text(
            if (syncing) "Syncing…" else snap.lastSync?.let { DateFormat.getTimeFormat(context).format(Date(it)) } ?: "",
            color = Palette.faint,
            fontSize = 12.sp,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onRefresh) {
            Icon(painterResource(R.drawable.ic_refresh), "Refresh", tint = Palette.muted, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Palette.raise).padding(14.dp)) { content() }
}

@Composable
private fun Section(title: String) {
    Text(
        title.uppercase(),
        color = Palette.faint,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.6.sp,
        modifier = Modifier.padding(start = 4.dp, top = 20.dp, bottom = 6.dp),
    )
}

@Composable
private fun Hint(text: String) {
    Text(text, color = Palette.faint, fontSize = 12.sp, lineHeight = 17.sp, modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 8.dp))
}

@Composable
private fun ProviderSettings(
    p: Provider,
    snap: Snapshot,
    index: Int,
    count: Int,
    onSignIn: (String) -> Unit,
    onMove: (Int) -> Unit,
) {
    val context = LocalContext.current
    val store = remember { UsageStore.get(context) }
    val scope = rememberCoroutineScope()
    val setting = snap.settings.provider(p.id)
    val service = snap.services[p.id]
    val connected = service?.connected == true

    Column(Modifier.padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(painterResource(Palette.logo(p.logo)), null, tint = Palette.logoTint(p.id), modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(p.name, color = if (setting.enabled) Palette.text else Palette.muted, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    when {
                        !setting.enabled -> "Hidden"
                        connected -> "Connected"
                        else -> "Not signed in"
                    },
                    color = if (setting.enabled && connected) Palette.ok else Palette.muted,
                    fontSize = 12.sp,
                )
            }
            MoveButton("↑", "Move ${p.name} up", enabled = index > 0) { onMove(-1) }
            MoveButton("↓", "Move ${p.name} down", enabled = index < count - 1) { onMove(1) }
            Spacer(Modifier.width(6.dp))
            Switch(
                checked = setting.enabled,
                onCheckedChange = { on ->
                    store.setProvider(p.id) { it.copy(enabled = on) }
                    if (on) Sync.runNow(context)
                },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = Palette.text,
                    checkedTrackColor = Palette.accent,
                    uncheckedThumbColor = Palette.muted,
                    uncheckedTrackColor = Palette.track,
                    uncheckedBorderColor = Palette.track,
                ),
            )
        }
        if (setting.enabled) {
            Row(Modifier.padding(start = 26.dp, top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                PlanPicker(p, setting.plan, Modifier.weight(1f)) { plan -> store.setProvider(p.id) { it.copy(plan = plan) } }
                if (connected) {
                    OutlinedButton(onClick = { scope.launch { Accounts.signOut(context, p.id) } }) { Text("Sign out", fontSize = 13.sp) }
                } else {
                    Button(onClick = { onSignIn(p.id) }) { Text("Sign in", fontSize = 13.sp) }
                }
            }
        }
    }
}

@Composable
private fun MoveButton(label: String, description: String, enabled: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(34.dp)) {
        Text(label, color = if (enabled) Palette.muted else Palette.track, fontSize = 16.sp)
    }
}

@Composable
private fun PlanPicker(p: Provider, current: String, modifier: Modifier, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val options = p.planOptions()
    Box(modifier) {
        OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
            Text(options.firstOrNull { it.first == current }?.second ?: "Auto-detect", fontSize = 13.sp, modifier = Modifier.weight(1f))
            Text("▾", color = Palette.muted)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (key, label) ->
                DropdownMenuItem(text = { Text(label) }, onClick = { open = false; onPick(key) })
            }
        }
    }
}

@Composable
private fun WidgetSection() {
    val context = LocalContext.current
    val manager = remember { AppWidgetManager.getInstance(context) }
    Column {
        Text(
            "Long-press your home screen, tap Widgets and pick AI Usage. It refreshes about every 15 minutes, " +
                "or tap its refresh button.",
            color = Palette.muted,
            fontSize = 13.sp,
            lineHeight = 18.sp,
        )
        if (manager.isRequestPinAppWidgetSupported) {
            Spacer(Modifier.height(10.dp))
            Button(onClick = { manager.requestPinAppWidget(ComponentName(context, UsageWidgetReceiver::class.java), null, null) }) {
                Text("Add widget to home screen", fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun AboutSection() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val update by Updates.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { if (Updates.supported) Updates.check() }
    // This only runs while the screen is showing, which is when Android allows the install dialog.
    LaunchedEffect(update) { if (update is UpdateState.NeedsConfirm) Updates.confirm(context) }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Version ${BuildConfig.VERSION_NAME}", color = Palette.text, fontSize = 14.sp)
            Text(
                when (val u = update) {
                    UpdateState.Unsupported -> "Updates come from the Play Store"
                    UpdateState.Idle -> ""
                    UpdateState.Checking -> "Checking for updates…"
                    UpdateState.Current -> "You're up to date"
                    is UpdateState.Available -> "Version ${u.release.version} is available"
                    is UpdateState.Downloading -> "Downloading ${(u.progress * 100).toInt()}%"
                    is UpdateState.Installing -> "Installing…"
                    is UpdateState.NeedsConfirm -> "Tap Install to finish updating"
                    is UpdateState.Failed -> u.message
                },
                color = if (update is UpdateState.Available) Palette.accent else Palette.muted,
                fontSize = 12.sp,
            )
        }
        when (update) {
            is UpdateState.Available -> Button(onClick = { Updates.start(context) }) { Text("Update", fontSize = 13.sp) }
            is UpdateState.NeedsConfirm -> Button(onClick = { Updates.confirm(context) }) { Text("Install", fontSize = 13.sp) }
            UpdateState.Unsupported -> {}
            else -> OutlinedButton(
                onClick = { scope.launch { Updates.check() } },
                enabled = update !is UpdateState.Checking && update !is UpdateState.Downloading && update !is UpdateState.Installing,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.text),
            ) { Text("Check", fontSize = 13.sp) }
        }
    }
    if (update is UpdateState.Failed) {
        Text(
            "Open releases",
            color = Palette.accent,
            fontSize = 12.sp,
            modifier = Modifier.padding(top = 6.dp).clickableNoRipple {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/Pengopal/ai-usage-tracker-widget/releases/latest")))
            },
        )
    }
}
