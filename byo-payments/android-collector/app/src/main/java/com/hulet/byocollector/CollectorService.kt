package com.hulet.byocollector

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*

/**
 * Foreground service that keeps the collector alive on the dedicated phone and,
 * every few minutes, flushes the offline queue. (A real "the phone went offline"
 * alert is best done server-side by watching for a gap in ingested payments; this
 * service's job is to keep the process resident and drain the retry queue.)
 */
class CollectorService : Service() {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var job: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(1, buildNotification("Watching for M-Pesa, telebirr and Tanzania mobile money payments"))
        job = scope.launch {
            while (isActive) {
                Backend.flushQueue(applicationContext)
                Backlog.run(applicationContext)
                delay(60 * 1000L)  // every minute
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        job?.cancel(); scope.cancel(); super.onDestroy()
    }

    private fun buildNotification(text: String): Notification {
        val chId = "collector"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(chId, "BYO Collector", NotificationManager.IMPORTANCE_LOW)
            )
        }
        return NotificationCompat.Builder(this, chId)
            .setContentTitle("BYO Collector")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
    }

    companion object {
        fun start(ctx: Context) {
            val i = Intent(ctx, CollectorService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
            else ctx.startService(i)
        }
    }
}
