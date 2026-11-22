package com.pengopal.aiusagetracker.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.provider.Settings
import com.pengopal.aiusagetracker.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * GitHub flavour: checks the latest GitHub release, downloads its .apk and
 * hands it to Android's package installer, which asks the user to confirm.
 */
object Updates {
    const val supported = true

    private val _state = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val state: StateFlow<UpdateState> = _state.asStateFlow()

    // Outlives the screen, so turning the phone or pressing Back doesn't cancel a download.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    // Android's "Install this update?" screen, kept until the app is in front to show it.
    @Volatile private var pendingConfirm: Intent? = null

    /** Starts downloading and installing the available update. */
    fun start(context: Context) {
        scope.launch { install(context) }
    }

    /** Shows Android's install confirmation if one is waiting. Call while the app is in front. */
    fun confirm(context: Context) {
        val intent = pendingConfirm ?: return
        val release = (state.value as? UpdateState.NeedsConfirm)?.release ?: return
        pendingConfirm = null
        _state.value = UpdateState.Installing(release)
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    suspend fun check() {
        _state.value = UpdateState.Checking
        _state.value = runCatching {
            val release = withContext(Dispatchers.IO) { parseRelease(get(RELEASES_API)) }
            when {
                !isNewer(release.version, BuildConfig.VERSION_NAME) -> UpdateState.Current
                release.apkUrl == null -> UpdateState.Current // a release without an Android build yet
                else -> UpdateState.Available(release)
            }
        }.getOrElse { UpdateState.Failed(it.message ?: "Couldn't check for updates") }
    }

    private suspend fun install(context: Context) {
        val release = (state.value as? UpdateState.Available)?.release ?: return
        val app = context.applicationContext
        // Android asks once per app before it may install other APKs.
        if (!app.packageManager.canRequestPackageInstalls()) {
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return
        }
        try {
            val file = withContext(Dispatchers.IO) { download(app, release) }
            _state.value = UpdateState.Installing(release)
            withContext(Dispatchers.IO) { commit(app, file) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.value = UpdateState.Failed(e.message ?: "Update failed")
        }
    }

    private fun open(url: String): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 15_000
        readTimeout = 30_000
        setRequestProperty("Accept", "application/vnd.github+json")
        setRequestProperty("User-Agent", "ai-usage-tracker-android")
    }

    private fun get(url: String): String {
        val c = open(url)
        try {
            if (c.responseCode != 200) error("GitHub returned HTTP ${c.responseCode}")
            return c.inputStream.bufferedReader().use { it.readText() }
        } finally {
            c.disconnect()
        }
    }

    private fun download(context: Context, release: Release): File {
        val dir = File(context.cacheDir, "updates").apply { deleteRecursively(); mkdirs() }
        val file = File(dir, "ai-usage-tracker-${release.version}.apk")
        val c = open(release.apkUrl!!).apply { setRequestProperty("Accept", "application/octet-stream") }
        try {
            if (c.responseCode != 200) error("Download failed: HTTP ${c.responseCode}")
            val total = c.contentLengthLong.takeIf { it > 0 } ?: release.apkSize
            c.inputStream.use { input ->
                file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    var done = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        if (total > 0) _state.value = UpdateState.Downloading(release, done.toFloat() / total)
                    }
                }
            }
        } finally {
            c.disconnect()
        }
        return file
    }

    private fun commit(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        val id = installer.createSession(params)
        try {
            write(context, installer, id, apk)
        } catch (e: Exception) {
            installer.abandonSession(id)
            throw e
        }
    }

    private fun write(context: Context, installer: PackageInstaller, id: Int, apk: File) {
        installer.openSession(id).use { session ->
            session.openWrite("update.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val callback = PendingIntent.getBroadcast(
                context,
                id,
                Intent(context, InstallResultReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(callback.intentSender)
        }
    }

    internal fun result(status: Int, message: String?, confirm: Intent?) {
        val release = when (val s = state.value) {
            is UpdateState.Installing -> s.release
            is UpdateState.NeedsConfirm -> s.release
            else -> null
        }
        if (release == null) {
            _state.value = if (status == PackageInstaller.STATUS_SUCCESS) UpdateState.Idle else UpdateState.Failed(message ?: "Install cancelled")
            return
        }
        val next = installResultState(status, message, release)
        if (next is UpdateState.NeedsConfirm && confirm == null) {
            _state.value = UpdateState.Failed("Android didn't ask to confirm the install")
            return
        }
        pendingConfirm = if (next is UpdateState.NeedsConfirm) confirm else null
        _state.value = next
    }
}

/**
 * Reports how the install went. Android won't open the confirm screen from the
 * background, so it is handed to [Updates] and shown when the app is in front.
 */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        @Suppress("DEPRECATION")
        val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
        Updates.result(
            intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE),
            intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE),
            confirm,
        )
    }
}
