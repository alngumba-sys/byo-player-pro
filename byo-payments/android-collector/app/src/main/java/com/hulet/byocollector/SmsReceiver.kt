package com.hulet.byocollector

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Receives every incoming SMS. Payments are trusted ONLY from the official sender ids:
 *   telebirr: "telebirr", "127", "ethio telecom"   -> parsed and forwarded to the backend
 *   M-Pesa:   "MPESA", "M-PESA"                     -> parsed and listed (forwarding comes next)
 *   Tanzania: "M-PESA" (Vodacom), "TIGOPESA"/"Mixx", "AIRTELMONEY", "HALOPESA" -> TzParser (formats still being confirmed)
 * "M-PESA" is shared by Kenya and Tanzania: the body decides (TZS / Tsh / Umepokea = Tanzania).
 * Every other SMS is ignored, but the last one seen is noted so you can tell reading works.
 * Multi-part SMS are joined before parsing.
 */
class SmsReceiver : BroadcastReceiver() {

    private val telebirr = setOf("telebirr", "127", "ethio telecom")
    private val mpesa = setOf("mpesa", "m-pesa")
    private val tzmm = setOf("tigopesa", "tigo pesa", "tigo-pesa", "mixx", "mixx by yas", "airtelmoney", "airtel money", "airtel-money", "halopesa", "halo pesa", "vodacom", "m-pesa tz")
    private val tzBody = Regex("\\b(TZS|Tsh|TSh|Umepokea|Tigo ?Pesa|Airtel ?Money|HaloPesa|Mixx)\\b", RegexOption.IGNORE_CASE)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (msgs.isEmpty()) return

        val sender = (msgs[0].displayOriginatingAddress ?: msgs[0].originatingAddress ?: "").trim()
        val body = msgs.joinToString("") { it.displayMessageBody ?: it.messageBody ?: "" }
        val s = sender.lowercase()
        val now = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date())
        val appCtx = context.applicationContext

        when {
            s in telebirr -> handleTelebirr(appCtx, sender, body, now)
            s in tzmm -> handleTz(appCtx, sender, body, now)
            s in mpesa && tzBody.containsMatchIn(body) -> handleTz(appCtx, sender, body, now)
            s in mpesa -> handleMpesa(appCtx, sender, body, now)
            else -> {
                Numbers.noteSeen(appCtx, "$now · from '$sender' · not a payment sender, ignored")
                Log.event(appCtx, "ignored SMS from '$sender'")
            }
        }
    }

    private fun handleTelebirr(ctx: Context, sender: String, body: String, now: String) {
        val p = TelebirrParser.parse(body)
        if (!p.ok && !body.contains("received", true)) {
            Numbers.noteSeen(ctx, "$now · telebirr · read, not a payment received (${p.reason})")
            Log.event(ctx, "telebirr SMS, not a receipt: ${p.reason}")
            return
        }
        Numbers.noteSeen(ctx, "$now · telebirr · " + (if (p.ok) "read ETB ${p.amountExact} ✓" else "read, could not understand (${p.reason})"))
        if (!p.ok) { record(ctx, "ETB", 0, 0.0, null, null, null, "unparsed", p.reason ?: "", body); return }
        CoroutineScope(Dispatchers.IO).launch {
            val r = Backend.sendOrQueue(ctx, Backend.item("telebirr", p.txnId, p.amountExact, "ETB", p.payerName, p.payerMasked, p.paidAt, body))
            Log.event(ctx, "telebirr ${p.txnId} → ${r.result} ${r.detail}")
            record(ctx, "ETB", p.amount, p.amountExact, p.payerName, p.payerLast4, p.txnId, statusOf(r.result), describe(r), body)
            Backend.flushQueue(ctx)
        }
    }

    private fun handleMpesa(ctx: Context, sender: String, body: String, now: String) {
        val p = MpesaParser.parse(body)
        if (!p.ok && !body.contains("received", true)) {
            Numbers.noteSeen(ctx, "$now · M-Pesa · read, not a payment received (${p.reason})")
            Log.event(ctx, "M-Pesa SMS, not a receipt: ${p.reason}")
            return
        }
        Numbers.noteSeen(ctx, "$now · M-Pesa · " + (if (p.ok) "read Ksh ${p.amountExact} ✓" else "read, could not understand (${p.reason})"))
        if (!p.ok) { record(ctx, "KES", 0, 0.0, null, null, null, "unparsed", p.reason ?: "", body); return }
        CoroutineScope(Dispatchers.IO).launch {
            val r = Backend.sendOrQueue(ctx, Backend.item("mpesa", p.txnId, p.amountExact, "KES", p.payerName, p.payerMasked, p.paidAt, body))
            Log.event(ctx, "M-Pesa ${p.txnId} → ${r.result} ${r.detail}")
            record(ctx, "KES", p.amount, p.amountExact, p.payerName, p.payerMasked ?: p.payerLast, p.txnId, statusOf(r.result), describe(r), body)
            Backend.flushQueue(ctx)
        }
    }

    private fun handleTz(ctx: Context, sender: String, body: String, now: String) {
        val p = TzParser.parse(body, sender)
        val w = TzParser.wallet(sender, body)
        if (!p.ok && !Regex("received|umepokea", RegexOption.IGNORE_CASE).containsMatchIn(body)) {
            Numbers.noteSeen(ctx, "$now · $w · read, not a payment received (${p.reason})")
            Log.event(ctx, "$w SMS, not a receipt: ${p.reason}")
            return
        }
        Numbers.noteSeen(ctx, "$now · $w · " + (if (p.ok) "read TZS ${p.amountExact} ✓" else "read, could not understand (${p.reason})"))
        if (!p.ok) { record(ctx, "TZS", 0, 0.0, null, null, null, "unparsed", p.reason ?: "", body); return }
        CoroutineScope(Dispatchers.IO).launch {
            val r = Backend.sendOrQueue(ctx, Backend.item("tzmm", p.txnId, p.amountExact, "TZS", p.payerName, p.payerMasked, p.paidAt, body))
            Log.event(ctx, "$w ${p.txnId} → ${r.result} ${r.detail}")
            record(ctx, "TZS", p.amount, p.amountExact, p.payerName, p.payerMasked ?: p.payerLast, p.txnId, statusOf(r.result), describe(r), body)
            Backend.flushQueue(ctx)
        }
    }

    private fun record(ctx: Context, cur: String, amount: Int, exact: Double, payer: String?, who: String?, txn: String?, status: String, detail: String, body: String) =
        PaymentLog.add(ctx, PaymentLog.Entry(timeMs = System.currentTimeMillis(), amount = amount, last4 = who, txnId = txn,
            status = status, detail = detail, raw = body, currency = cur, exact = exact, payer = payer))

    private fun describe(r: Backend.Reply): String = when (r.result) {
        "matched" -> "Matched: ${r.detail}"
        "duplicate" -> "Already received earlier (${r.detail})"
        "queued" -> "No internet or server problem; will send again (${r.detail})"
        else -> r.detail
    }

    private fun statusOf(result: String): String = when (result) {
        "matched", "duplicate" -> "sent"
        "queued" -> "retry"
        "unmatched" -> "unmatched"
        "partial" -> "partial"
        "held" -> "held"
        else -> "error"
    }
}
