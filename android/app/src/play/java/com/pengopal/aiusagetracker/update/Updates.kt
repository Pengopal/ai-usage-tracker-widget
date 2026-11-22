package com.pengopal.aiusagetracker.update

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Play flavour: the Play Store updates the app, so there is no self-updater. */
object Updates {
    const val supported = false

    val state: StateFlow<UpdateState> = MutableStateFlow(UpdateState.Unsupported)

    suspend fun check() = Unit

    fun start(context: Context) = Unit

    fun confirm(context: Context) = Unit
}
