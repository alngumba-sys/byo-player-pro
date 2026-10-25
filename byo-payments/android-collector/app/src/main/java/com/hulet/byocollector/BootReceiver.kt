package com.hulet.byocollector

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restart the keep-alive service when the dedicated phone reboots. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            CollectorService.start(context.applicationContext)
            Log.event(context, "device rebooted — service restarted")
        }
    }
}
