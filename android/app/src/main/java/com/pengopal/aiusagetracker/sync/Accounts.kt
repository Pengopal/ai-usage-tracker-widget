package com.pengopal.aiusagetracker.sync

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage
import com.pengopal.aiusagetracker.core.Catalog
import com.pengopal.aiusagetracker.data.ServiceState
import com.pengopal.aiusagetracker.data.UsageStore
import com.pengopal.aiusagetracker.widget.UsageWidget

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
        for (name in names) {
            cookies.setCookie(origin, "$name=; Max-Age=0; Path=/")
            cookies.setCookie(origin, "$name=; Max-Age=0; Path=/; Domain=.${provider.host}")
        }
        cookies.flush()
        WebStorage.getInstance().deleteOrigin(origin)
        UsageStore.get(context).setService(id, ServiceState())
        UsageWidget.refresh(context)
    }
}
