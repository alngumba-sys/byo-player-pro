package com.hulet.byocollector

/**
 * M-Pesa "received" SMS parser (Kenya, personal line or Pochi la Biashara).
 * Example:
 *   "TJ81AB12CD Confirmed.You have received Ksh500.00 from JOHN DOE 0712345678 on 18/10/26 at 12:30 PM
 *    New M-PESA balance is Ksh1,250.00. ..."
 * The sender number may be partly masked (e.g. 254712***678); we keep its last digits.
 */
object MpesaParser {
    data class Result(
        val ok: Boolean,
        val reason: String? = null,
        val amount: Int = 0,
        val amountExact: Double = 0.0,
        val payerName: String? = null,
        val payerLast: String? = null,   // last 3-4 visible digits
        val payerMasked: String? = null, // as shown, e.g. 0114***089
        val txnId: String? = null,
        val paidAt: String? = null,
        val raw: String = ""
    )

    fun parse(body: String): Result {
        val text = body.replace(' ', ' ').replace(Regex("\\s+"), " ").trim()
        if (!Regex("you have received", RegexOption.IGNORE_CASE).containsMatchIn(text))
            return Result(false, "not an incoming payment", raw = body)
        val txn = Regex("^([A-Z0-9]{10})\\b").find(text)?.groupValues?.get(1)
            ?: Regex("\\b([A-Z0-9]{10})\\s+Confirmed", RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1)?.uppercase()
            ?: return Result(false, "transaction code not found", raw = body)
        val amtM = Regex("received\\s+Ksh\\s*([\\d,]+(?:\\.\\d{1,2})?)", RegexOption.IGNORE_CASE).find(text)
            ?: return Result(false, "amount not found", raw = body)
        val v = amtM.groupValues[1].replace(",", "").toDoubleOrNull() ?: return Result(false, "bad amount", raw = body)
        if (v <= 0) return Result(false, "bad amount", raw = body)
        val fromM = Regex("from\\s+(.+?)\\s+(\\+?[0-9][0-9*]{5,})\\s+on\\s", RegexOption.IGNORE_CASE).find(text)
        val name = fromM?.groupValues?.get(1)?.trim()
        val digits = fromM?.groupValues?.get(2)?.let { Regex("(\\d{3,4})$").find(it)?.groupValues?.get(1) }
        val dt = Regex("on\\s+(\\d{1,2})/(\\d{1,2})/(\\d{2,4})\\s+at\\s+(\\d{1,2}):(\\d{2})\\s*([AP]M)", RegexOption.IGNORE_CASE).find(text)
        val paidAt = dt?.let {
            val (d, m, y, h, mi, ap) = it.destructured
            var hh = h.toInt() % 12; if (ap.equals("PM", true)) hh += 12
            val yyyy = if (y.length == 2) "20$y" else y
            "%s-%02d-%02dT%02d:%s:00+03:00".format(yyyy, m.toInt(), d.toInt(), hh, mi)
        }
        return Result(true, amount = Math.floor(v).toInt(), amountExact = v, payerName = name,
            payerLast = digits, payerMasked = fromM?.groupValues?.get(2), txnId = txn, paidAt = paidAt, raw = body)
    }
}
