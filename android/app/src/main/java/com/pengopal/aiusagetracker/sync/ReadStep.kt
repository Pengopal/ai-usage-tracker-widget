package com.pengopal.aiusagetracker.sync

import java.net.URI

/** What the sync loop does next for one provider's WebView. */
sealed interface ReadStep {
    /** Load the core and start the reader in the current page. */
    data object Inject : ReadStep

    data object Wait : ReadStep

    data class Done(val json: String) : ReadStep
}

/**
 * Decides the next step from the WebView's committed [url]. The reader only
 * needs a page on the provider's own origin (its requests carry the site's
 * cookies), so it starts as soon as one is committed instead of waiting for the
 * whole web app to finish loading, which on a phone in the background can take
 * longer than the sync allows. [started] is whether the current page already
 * has the reader running; a navigation drops it, so it is injected again.
 */
fun readStep(url: String?, providerHost: String, started: Boolean, result: String?): ReadStep {
    if (result != null) return ReadStep.Done(result)
    val host = url?.let { runCatching { URI(it).host }.getOrNull() }
    return if (host == providerHost && !started) ReadStep.Inject else ReadStep.Wait
}
