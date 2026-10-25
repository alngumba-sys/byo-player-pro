package com.hulet.byocollector

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * A friendly, persisted list of the telebirr payments this phone has caught and
 * forwarded to the TV system. Shown on the home screen as simple cards.
 * Newest first; capped so it never grows unbounded.
 */
object PaymentLog {
    private const val PREFS = "byo_collector"
    private const val KEY = "payments_v1"
    private const val MAX = 100

    data class Entry(
        val timeMs: Long,
        val amount: Int,          // whole birr (0 if unparseable)
        val last4: String?,       // payer last 4 (null if unparseable)
        val txnId: String?,
        val status: String,       // "sent" | "retry" | "error"
        val detail: String,       // server reply, human readable
        val raw: String,          // the raw SMS, for the details view
        val currency: String = "ETB",
        val exact: Double = 0.0,  // amount with cents
        val payer: String? = null // payer name as shown in the SMS
    )

    fun add(ctx: Context, e: Entry) {
        val arr = load(ctx)
        val o = JSONObject()
            .put("t", e.timeMs).put("amt", e.amount).put("last4", e.last4 ?: "")
            .put("txn", e.txnId ?: "").put("st", e.status).put("det", e.detail).put("raw", e.raw)
            .put("cur", e.currency).put("ex", e.exact).put("payer", e.payer ?: "")
        // newest first; drop oldest beyond MAX
        val next = JSONArray().put(o)
        for (i in 0 until arr.length()) { if (next.length() >= MAX) break; next.put(arr.getJSONObject(i)) }
        save(ctx, next)
    }

    /** Change the status of one entry (found by its time). */
    fun update(ctx: Context, timeMs: Long, status: String, detail: String) {
        val arr = load(ctx)
        for (i in 0 until arr.length()) { val o = arr.getJSONObject(i); if (o.optLong("t") == timeMs) { o.put("st", status).put("det", detail); break } }
        save(ctx, arr)
    }

    fun all(ctx: Context): List<Entry> {
        val arr = load(ctx); val out = ArrayList<Entry>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            out.add(Entry(
                o.optLong("t"), o.optInt("amt"), o.optString("last4").ifBlank { null },
                o.optString("txn").ifBlank { null }, o.optString("st"),
                o.optString("det"), o.optString("raw"),
                o.optString("cur").ifBlank { "ETB" }, o.optDouble("ex", 0.0).let { if (it.isNaN()) 0.0 else it },
                o.optString("payer").ifBlank { null }
            ))
        }
        return out
    }

    fun todayCount(ctx: Context): Int {
        val startOfDay = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0)
            set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
        }.timeInMillis
        return all(ctx).count { it.timeMs >= startOfDay && it.amount > 0 }
    }

    private fun load(ctx: Context): JSONArray =
        try { JSONArray(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]")) }
        catch (_: Exception) { JSONArray() }
    private fun save(ctx: Context, arr: JSONArray) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, arr.toString()).apply()
}
