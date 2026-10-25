package com.hulet.byocollector

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Tiny ring-buffer event log shown on the main screen, persisted across restarts. */
object Log {
    private const val PREFS = "byo_collector"
    private const val KEY = "events"
    private const val MAX = 40

    fun event(ctx: Context, msg: String) {
        val ts = SimpleDateFormat("MM-dd HH:mm:ss", Locale.US).format(Date())
        val line = "$ts  $msg"
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val cur = p.getString(KEY, "") ?: ""
        val lines = (listOf(line) + cur.split("\n")).filter { it.isNotBlank() }.take(MAX)
        p.edit().putString(KEY, lines.joinToString("\n")).apply()
    }
    fun recent(ctx: Context): String =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "") ?: ""
}
