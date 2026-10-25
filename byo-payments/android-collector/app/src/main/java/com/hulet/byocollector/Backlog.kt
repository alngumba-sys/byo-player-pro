package com.hulet.byocollector

import android.content.Context

/**
 * Payments this phone read but never got to the TV system (read by an older version, or while
 * offline / before the key was set) are sent automatically: on app start, when the key is saved,
 * and every few minutes by the background service. Only the last 24 hours, so old ones don't resurface.
 */
object Backlog {
    private val pending = setOf("local", "retry", "error")
    @Volatile private var running = false

    fun run(ctx: Context) {
        if (running) return; running = true
        try {
            val since = System.currentTimeMillis() - 24 * 3600_000L
            for (e in PaymentLog.all(ctx)) {
                if (e.timeMs < since || e.status !in pending || e.raw.isBlank()) continue
                val tz = e.currency == "TZS"
                val mp = !tz && (e.currency == "KES" || e.raw.contains("Ksh", true))
                val item = if (tz) {
                    val p = TzParser.parse(e.raw); if (!p.ok) continue
                    Backend.item("tzmm", p.txnId, p.amountExact, "TZS", p.payerName, p.payerMasked, p.paidAt, e.raw)
                } else if (mp) {
                    val p = MpesaParser.parse(e.raw); if (!p.ok) continue
                    Backend.item("mpesa", p.txnId, p.amountExact, "KES", p.payerName, p.payerMasked, p.paidAt, e.raw)
                } else {
                    val p = TelebirrParser.parse(e.raw); if (!p.ok) continue
                    Backend.item("telebirr", p.txnId, p.amountExact, "ETB", p.payerName, p.payerMasked, p.paidAt, e.raw)
                }
                val r = Backend.trySend(ctx, item) ?: break      // offline or no key yet: try again later
                val st = when (r.result) { "matched", "duplicate" -> "sent"; "unmatched" -> "unmatched"; "partial" -> "partial"; "held" -> "held"; else -> "error" }
                PaymentLog.update(ctx, e.timeMs, st, if (r.result == "matched") "Matched: ${r.detail}" else r.detail)
                Log.event(ctx, "backlog ${e.txnId} → ${r.result} ${r.detail}")
            }
        } finally { running = false }
    }
}
