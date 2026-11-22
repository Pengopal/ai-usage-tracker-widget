package com.pengopal.aiusagetracker.sync

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage
import com.pengopal.aiusagetracker.core.Catalog
import com.pengopal.aiusagetracker.data.ServiceState
import com.pengopal.aiusagetracker.data.UsageStore
import com.pengopal.aiusagetracker.widget.UsageWidget

/**
 * The Set-Cookie values that expire [name] on [host]. Every one is Secure:
 * Chromium silently drops a `__Secure-`/`__Host-` cookie set without it.
 * `__Host-` cookies can't carry a Domain, so they get only the host-only form.
 */
fun expiryCookies(name: String, host: String): List<String> {
    val base = "$name=; Max-Age=0; Path=/; Secure"
    return if (name.startsWith("__Host-")) listOf(base) else listOf(base, "$base; Domain=.$host")
}

object Accounts {
    /**
     * Signs out of one provider: expires its site cookies and clears its site
     * storage. Android's cookie store can't be cleared per site, so each cookie
     * is overwritten with an expired one.
     */
    suspend fun signOut(context: Context, id: String) {
        val provider = Catalog.load(context)[id] ?: return
        val origin = WebViews.originOf(provider.home)
        val cookies = CookieManager.getInstance()
        val names = cookies.getCookie(origin)?.split(";")?.map { it.substringBefore("=").trim() }?.filter { it.isNotEmpty() } ?: emptyList()
        for (name in names) expiryCookies(name, provider.host).forEach { cookies.setCookie(origin, it) }
        cookies.flush()
        WebStorage.getInstance().deleteOrigin(origin)
        UsageStore.get(context).setService(id, ServiceState())
        UsageWidget.refresh(context)
    }
}
