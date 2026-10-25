package com.hulet.byocollector

/**
 * telebirr receipt-SMS parser. Port of the verified JS/TS parser (21/21 tests).
 * Only reads the SMS body; the sender-id "telebirr" check is done in SmsReceiver.
 */
object TelebirrParser {

    data class Result(
        val ok: Boolean,
        val reason: String? = null,
        val amount: Int = 0,          // whole birr — what the matcher keys on
        val amountExact: Double = 0.0,
        val payerName: String? = null,
        val payerLast4: String? = null,
        val payerMasked: String? = null, // as shown, e.g. 2519****1234
        val txnId: String? = null,
        val paidAt: String? = null,   // ISO, EAT (+03:00)
        val balanceAfter: Double? = null,
        val raw: String = ""
    )

    private fun normalise(s: String) = s.replace('\u00a0', ' ').replace(Regex("\\s+"), " ").trim()
    private fun money(s: String): Pair<Int, Double>? {
        val v = s.replace(",", "").toDoubleOrNull() ?: return null
        return Math.floor(v).toInt() to v
    }
    private fun last4Of(masked: String): String? =
        Regex("(\\d{4})\\s*\\)?\\s*$").find(masked)?.groupValues?.get(1)

    fun parse(body: String): Result {
        val raw = body
        val text = normalise(body)

        if (!Regex("you have received", RegexOption.IGNORE_CASE).containsMatchIn(text))
            return Result(false, "not an incoming receipt", raw = raw)

        val amtM = Regex("received\\s+ETB\\s*([\\d,]+(?:\\.\\d{1,2})?)", RegexOption.IGNORE_CASE).find(text)
            ?: return Result(false, "amount not found", raw = raw)
        val amount = money(amtM.groupValues[1]) ?: return Result(false, "bad amount", raw = raw)
        if (amount.second <= 0) return Result(false, "bad amount", raw = raw)

        val fromM = Regex("from\\s+(.+?)\\s*\\(([0-9*]+)\\)", RegexOption.IGNORE_CASE).find(text)
        val payerName = fromM?.groupValues?.get(1)?.trim()
        val payerLast4Val = fromM?.let { last4Of(it.groupValues[2]) }
            ?: return Result(false, "payer last4 not found", raw = raw)

        val txnM = Regex("transaction number is\\s+([A-Z0-9]+)", RegexOption.IGNORE_CASE).find(text)
            ?: return Result(false, "txn id not found", raw = raw)
        val txnId = txnM.groupValues[1].uppercase()

        val dtM = Regex("on\\s+(\\d{2})/(\\d{2})/(\\d{4})\\s+(\\d{2}):(\\d{2}):(\\d{2})").find(text)
        val paidAt = dtM?.let {
            val (dd, mm, yyyy, HH, MM, SS) = it.destructured
            "$yyyy-$mm-${dd}T$HH:$MM:$SS+03:00"
        }

        val balM = Regex("balance is\\s+ETB\\s*([\\d,]+(?:\\.\\d{1,2})?)", RegexOption.IGNORE_CASE).find(text)
        val balance = balM?.let { money(it.groupValues[1])?.second }

        return Result(
            ok = true, amount = amount.first, amountExact = amount.second,
            payerName = payerName, payerLast4 = payerLast4Val, payerMasked = fromM.groupValues[2], txnId = txnId,
            paidAt = paidAt, balanceAfter = balance, raw = raw
        )
    }
}
