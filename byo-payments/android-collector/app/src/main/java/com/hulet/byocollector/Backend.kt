package com.hulet.byocollector

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Sends payments this phone has read to the BYO backend (byo_collector_ingest), with an
 * on-disk queue so nothing is lost if the phone briefly drops internet. Each payment is
 * keyed by its transaction code, so sending twice is safe (the backend ignores repeats).
 */
object Backend {
    private const val PREFS = "byo_collector"
    private const val QUEUE = "queue_v2"             // JSON array of pending payment items
    private const val KEY_API = "collector_api_key"  // set in Settings (made in the support console)

    fun apiKey(ctx: Context): String {
        val saved = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_API, null)
        return if (!saved.isNullOrBlank() && saved != "SET_ME_IN_SETTINGS") saved else BuildConfig.COLLECTOR_API_KEY
    }
    fun setApiKey(ctx: Context, key: String) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_API, key).apply()

    /** A payment as the backend wants it. */
    fun item(method: String, txn: String?, amount: Double, currency: String, payerName: String?, payerMasked: String?, paidAt: String?, raw: String): JSONObject =
        JSONObject().put("method", method).put("txn", txn ?: "").put("amount", amount).put("currency", currency)
            .put("payer_name", payerName ?: "").put("payer_masked", payerMasked ?: "").put("paid_at", paidAt ?: "").put("raw", raw.take(1000))

    data class Reply(val result: String, val detail: String, val tv: String?)

    /** Send one payment now; if the phone is offline, keep it and try again later. */
    fun sendOrQueue(ctx: Context, it: JSONObject): Reply = try {
        val res = ingest(ctx, JSONArray().put(it))
        val r = res.optJSONArray("results")?.optJSONObject(0)
        if (!res.optBoolean("ok", false)) Reply("error", res.optString("error", "rejected"), null)
        else Reply(r?.optString("result") ?: "sent", r?.optString("detail") ?: "", r?.optString("tv")?.ifBlank { null }?.takeIf { it != "null" })
    } catch (e: Exception) {
        enqueue(ctx, it); Reply("queued", e.message ?: "offline", null)
    }

    /** Send once without queueing; null when offline or the key isn't accepted yet. */
    fun trySend(ctx: Context, it: JSONObject): Reply? = try {
        val res = ingest(ctx, JSONArray().put(it))
        if (!res.optBoolean("ok", false)) null
        else { val r = res.optJSONArray("results")?.optJSONObject(0); Reply(r?.optString("result") ?: "sent", r?.optString("detail") ?: "", null) }
    } catch (_: Exception) { null }

    /** Send anything that was queued while offline. */
    fun flushQueue(ctx: Context) {
        val arr = loadQueue(ctx); if (arr.length() == 0) return
        try { val r = ingest(ctx, arr); if (r.optBoolean("ok", false)) saveQueue(ctx, JSONArray()) } catch (_: Exception) { }
    }

    /** Save the receiving numbers on the server so the TVs show them. Returns null on success, else the error. */
    fun saveNumbers(ctx: Context, telebirr: String, mpesa: String, tzmm: String = ""): String? = try {
        val r = rpc("byo_collector_numbers", JSONObject().put("p_key", apiKey(ctx)).put("p_telebirr", telebirr).put("p_mpesa", mpesa).put("p_tzmm", tzmm))
        if (r.optBoolean("ok", false)) null else r.optString("error", "rejected")
    } catch (e: Exception) { e.message ?: "offline" }

    private fun ingest(ctx: Context, items: JSONArray): JSONObject =
        rpc("byo_collector_ingest", JSONObject().put("p_key", apiKey(ctx)).put("p_items", items))

    private fun rpc(fn: String, body: JSONObject): JSONObject {
        val conn = (URL(BuildConfig.SUPABASE_URL.trimEnd('/') + "/rest/v1/rpc/" + fn).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 15000; readTimeout = 15000; doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("apikey", BuildConfig.SUPABASE_ANON)
            setRequestProperty("Authorization", "Bearer " + BuildConfig.SUPABASE_ANON)
        }
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = conn.responseCode
        val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText() ?: ""
        if (code == 404) throw RuntimeException("backend not updated yet (run 0012_payments.sql)")
        if (code !in 200..299) throw RuntimeException("HTTP $code: ${text.take(200)}")
        return try { JSONObject(text) } catch (_: Exception) { JSONObject().put("ok", false).put("error", text.take(200)) }
    }

    // ---- queue ----
    private fun loadQueue(ctx: Context): JSONArray =
        try { JSONArray(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(QUEUE, "[]")) } catch (_: Exception) { JSONArray() }
    private fun saveQueue(ctx: Context, arr: JSONArray) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(QUEUE, arr.toString()).apply()
    private fun enqueue(ctx: Context, it: JSONObject) { val a = loadQueue(ctx); a.put(it); saveQueue(ctx, a) }
    fun queueSize(ctx: Context): Int = loadQueue(ctx).length()
}
