package com.pengopal.aiusagetracker

import android.app.Application
import com.pengopal.aiusagetracker.sync.Sync

class AiUsageApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Sync.schedule(this)
    }
}
