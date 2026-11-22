package com.pengopal.aiusagetracker.sync

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.view.View
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.pengopal.aiusagetracker.core.Catalog
import com.pengopal.aiusagetracker.core.CoreScripts
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.util.UUID

/**
 * Reads one provider in an off-screen WebView on the provider's own site, the
 * Android counterpart of the desktop's hidden sync window. Returns the core's
 * interpret() result: {connected:false} | {connected:true,error} | {connected:true,windows,...}.
 */
class CoreRunner(private val context: Context) {

    suspend fun read(id: String): JSONObject = withContext(Dispatchers.Main) {
        val provider = Catalog.load(context)[id] ?: error("Unknown provider $id")
        val bundle = CoreScripts.bundle(context)
        val token = UUID.randomUUID().toString()
        val web = WebViews.create(context.applicationContext)
        // Off-screen views still need a size for some sites to run their scripts.
        web.measure(View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(1920, View.MeasureSpec.EXACTLY))
        web.layout(0, 0, 1080, 1920)

        var onSite = false
        var awaySince = 0L
        var loadError: String? = null
        web.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                onSite = false
            }

            override fun onPageFinished(view: WebView, url: String) {
                onSite = Uri.parse(url).host == provider.host
                awaySince = if (onSite) 0L else System.currentTimeMillis()
                if (onSite) view.evaluateJavascript(bundle + CoreScripts.call(id, token), null)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) loadError = "Can't reach ${provider.host} (${error.description})"
            }
        }
        try {
            web.loadUrl(provider.home)
            withTimeout(45_000) {
                while (true) {
                    loadError?.let { throw IllegalStateException(it) }
                    if (onSite) {
                        web.evaluateString(CoreScripts.poll(token))?.let { return@withTimeout JSONObject(it) }
                    } else if (awaySince > 0 && System.currentTimeMillis() - awaySince > 5_000) {
                        // Sent off to a sign-in host and left there: not signed in.
                        return@withTimeout JSONObject().put("connected", false)
                    }
                    delay(300)
                }
                @Suppress("UNREACHABLE_CODE")
                JSONObject()
            }
        } finally {
            web.stopLoading()
            web.destroy()
        }
    }
}
