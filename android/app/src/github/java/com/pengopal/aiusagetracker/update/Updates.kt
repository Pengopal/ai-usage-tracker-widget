package com.pengopal.aiusagetracker.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.provider.Settings
import com.pengopal.aiusagetracker.BuildConfig
import kotlinx.coroutines.Dispatchers
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

    /** Downloads and installs the available update. */
    suspend fun install(context: Context) {
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

    internal fun finished(message: String?) {
        _state.value = if (message == null) UpdateState.Idle else UpdateState.Failed(message)
    }
}

/** Shows Android's install confirmation, then reports how it went. */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> Updates.finished(null)
            else -> Updates.finished(intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Install cancelled")
        }
    }
}
