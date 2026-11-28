package com.pengopal.aiusagetracker.sync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.await
import com.pengopal.aiusagetracker.R
import com.pengopal.aiusagetracker.core.Catalog
import com.pengopal.aiusagetracker.core.orderedIds
import com.pengopal.aiusagetracker.data.ServiceState
import com.pengopal.aiusagetracker.data.UsageStore
import com.pengopal.aiusagetracker.widget.UsageWidget
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.TimeUnit

object Sync {
    private const val WIDGET_REFRESH = "sync-widget-refresh"
    private val mutex = Mutex()
    private val _running = MutableStateFlow(false)
    val running: StateFlow<Boolean> = _running.asStateFlow()

    /** Reads every shown provider and stores the results. One sync at a time. */
    suspend fun run(context: Context) = mutex.withLock {
        val app = context.applicationContext
        _running.value = true
        try {
            UsageWidget.refresh(app)
            val store = UsageStore.get(app)
            val settings = store.state.value.settings
            val catalog = Catalog.load(app)
            val ids = orderedIds(settings.order, catalog).filter { settings.provider(it).enabled }
            val runner = CoreRunner(app)
            val results = coroutineScope {
                ids.map { id -> async { id to readResult(catalog[id]?.host ?: id) { runner.read(id) } } }.awaitAll()
            }
            val now = System.currentTimeMillis()
            store.update { s ->
                s.copy(
                    services = s.services + results.map { (id, r) -> id to merge(s.services[id] ?: ServiceState(), r, now) },
                    lastSync = now,
                )
            }
        } finally {
            _running.value = false
            UsageWidget.refresh(app)
        }
    }

    private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** Every 15 minutes (Android's minimum) while there is a network. */
    fun schedule(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "sync-periodic",
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(network).build(),
        )
    }

    fun runNow(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            "sync-now",
            // Queue behind a sync already running, so a sign-in that lands mid-sync still gets read.
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(network).build(),
        )
    }

    suspend fun refreshFromWidget(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            WIDGET_REFRESH,
            ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(network)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build(),
        ).await()
    }

    fun widgetRefreshPending(context: Context) = WorkManager.getInstance(context)
        .getWorkInfosForUniqueWorkFlow(WIDGET_REFRESH)
        .map { jobs -> jobs.any { !it.state.isFinished } }
        .distinctUntilChanged()
}

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    // WorkManager uses a foreground notification for expedited work before Android 12.
    override suspend fun getForegroundInfo(): ForegroundInfo {
        val channelId = "usage_refresh"
        val manager = applicationContext.getSystemService(NotificationManager::class.java)!!
        manager.createNotificationChannel(NotificationChannel(
            channelId,
            applicationContext.getString(R.string.refresh_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ))
        val notification = NotificationCompat.Builder(applicationContext, channelId)
            .setSmallIcon(R.drawable.ic_refresh)
            .setContentTitle(applicationContext.getString(R.string.refresh_notification_title))
            .setOngoing(true)
            .build()
        return ForegroundInfo(1, notification)
    }

    override suspend fun doWork(): Result {
        Sync.run(applicationContext)
        return Result.success()
    }
}
