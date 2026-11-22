package com.pengopal.aiusagetracker.sync

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebView
import com.pengopal.aiusagetracker.core.CoreScripts
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import org.json.JSONTokener
import kotlin.coroutines.resume

object WebViews {
    /**
     * A WebView set up like the user's mobile Chrome: sign-in and sync share the
     * same cookie store and user agent, so sessions (and Cloudflare clearance)
     * carry over between them.
     */
    @SuppressLint("SetJavaScriptEnabled")
    fun create(context: Context): WebView = WebView(context).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.setSupportMultipleWindows(false) // sign-in popups open in place
        settings.userAgentString = settings.userAgentString
            .replace("; wv)", ")")
            .replace(Regex("Version/\\S+ "), "")
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
    }

    fun originOf(url: String): String {
        val u = Uri.parse(url)
        return "${u.scheme}://${u.host}"
    }
}

/** evaluateJavascript as a suspend call; decodes a JS string result. */
suspend fun WebView.evaluateString(js: String): String? = suspendCancellableCoroutine { cont ->
    evaluateJavascript(js) { raw ->
        val value = runCatching { JSONTokener(raw ?: "null").nextValue() }.getOrNull()
        cont.resume(value as? String)
    }
}

/** Runs the provider's reader in whatever page this WebView is showing. */
suspend fun WebView.readInPage(bundle: String, id: String, token: String, timeoutMs: Long): JSONObject? {
    evaluateString(bundle + CoreScripts.call(id, token))
    val end = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < end) {
        evaluateString(CoreScripts.poll(token))?.let { return runCatching { JSONObject(it) }.getOrNull() }
        delay(300)
    }
    return null
}
