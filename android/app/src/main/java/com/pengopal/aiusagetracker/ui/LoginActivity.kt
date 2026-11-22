package com.pengopal.aiusagetracker.ui

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.view.Gravity
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.lifecycle.lifecycleScope
import com.pengopal.aiusagetracker.core.Catalog
import com.pengopal.aiusagetracker.core.CoreScripts
import com.pengopal.aiusagetracker.sync.Sync
import com.pengopal.aiusagetracker.sync.WebViews
import com.pengopal.aiusagetracker.sync.readInPage
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * The provider's real sign-in page. Once the session can read usage, the page
 * closes by itself and a sync starts, like the desktop sign-in window.
 */
class LoginActivity : ComponentActivity() {
    private lateinit var web: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent.getStringExtra(EXTRA_PROVIDER) ?: return finish()
        val provider = Catalog.load(this)[id] ?: return finish()

        val frame = FrameLayout(this)
        web = WebViews.create(this, popups = true).apply {
            webViewClient = WebViewClient()
            webChromeClient = PopupClient(frame)
        }
        frame.addView(web, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        val header = TextView(this).apply {
            text = "Sign in to ${provider.name}"
            setTextColor(Color.parseColor("#ECECF1"))
            textSize = 15f
            gravity = Gravity.CENTER_VERTICAL
            setPadding(48, 28, 48, 28)
            setBackgroundColor(Color.parseColor("#0E0E12"))
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0E0E12"))
            addView(header, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(frame, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.updatePadding(top = bars.top, bottom = bars.bottom)
            insets
        }
        setContentView(root)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val popup = popups.lastOrNull()
                when {
                    popup != null && popup.canGoBack() -> popup.goBack()
                    popup != null -> closePopup(popup)
                    web.canGoBack() -> web.goBack()
                    else -> finish()
                }
            }
        })
        web.loadUrl(provider.loginUrl)

        // Every few seconds, while on the provider's own site, check whether the
        // session can read usage yet.
        val bundle = CoreScripts.bundle(this)
        lifecycleScope.launch {
            while (isActive) {
                delay(3_000)
                val url = web.url ?: continue
                if (Uri.parse(url).host != provider.host) continue
                val res = web.readInPage(bundle, id, UUID.randomUUID().toString(), 10_000)
                if (res?.optBoolean("connected") == true) {
                    CookieManager.getInstance().flush()
                    Sync.runNow(this@LoginActivity)
                    setResult(RESULT_OK)
                    finish()
                    break
                }
            }
        }
    }

    /** Popup windows the sign-in page opened, newest last. They sit on top of [web]. */
    private val popups = mutableListOf<WebView>()

    /**
     * Opens window.open() popups (such as Google sign-in) as real child windows over the
     * page, so they can hand the sign-in back to it and close themselves.
     */
    private inner class PopupClient(private val frame: FrameLayout) : WebChromeClient() {
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            val popup = WebViews.create(this@LoginActivity, popups = true).apply {
                webViewClient = WebViewClient()
                webChromeClient = this@PopupClient
            }
            popups += popup
            frame.addView(popup, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            (resultMsg.obj as WebView.WebViewTransport).webView = popup
            resultMsg.sendToTarget()
            return true
        }

        override fun onCloseWindow(window: WebView) = closePopup(window)
    }

    private fun closePopup(popup: WebView) {
        if (!popups.remove(popup)) return
        (popup.parent as? ViewGroup)?.removeView(popup)
        popup.destroy()
    }

    override fun onDestroy() {
        popups.toList().forEach(::closePopup)
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_PROVIDER = "provider"

        fun intent(context: Context, id: String) =
            Intent(context, LoginActivity::class.java).putExtra(EXTRA_PROVIDER, id)
    }
}
