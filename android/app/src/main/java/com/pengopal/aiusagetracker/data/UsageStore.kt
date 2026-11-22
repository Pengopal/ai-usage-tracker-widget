package com.pengopal.aiusagetracker.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.io.File

/**
 * Readings and settings in one JSON file in the app's private storage, so the
 * widget can draw without a WebView. Everything runs in the app's process, so a
 * StateFlow keeps the app screen and the widget in step.
 */
class UsageStore private constructor(private val file: File) {
    private val _state = MutableStateFlow(read())
    val state: StateFlow<Snapshot> = _state.asStateFlow()

    private fun read(): Snapshot =
        runCatching { snapshotFromJson(JSONObject(file.readText())) }.getOrDefault(Snapshot())

    @Synchronized
    fun update(change: (Snapshot) -> Snapshot): Snapshot {
        val next = change(_state.value)
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(next.toJson().toString())
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
        _state.value = next
        return next
    }

    fun setService(id: String, value: ServiceState) = update { it.copy(services = it.services + (id to value)) }

    fun setProvider(id: String, change: (ProviderSetting) -> ProviderSetting) = update {
        it.copy(settings = it.settings.copy(providers = it.settings.providers + (id to change(it.settings.provider(id)))))
    }

    fun setOrder(order: List<String>) = update { it.copy(settings = it.settings.copy(order = order)) }

    companion object {
        @Volatile private var instance: UsageStore? = null

        fun get(context: Context): UsageStore = instance ?: synchronized(this) {
            instance ?: UsageStore(File(context.applicationContext.filesDir, "usage.json")).also { instance = it }
        }
    }
}
