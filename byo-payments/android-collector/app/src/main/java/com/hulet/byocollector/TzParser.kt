package com.hulet.byocollector

/**
 * Tanzania mobile-money "received" SMS parser (M-Pesa Tanzania, Tigo Pesa / Mixx by Yas, Airtel Money, HaloPesa).
 *
 * SCAFFOLD: the exact wallet formats are still to be confirmed. Until then this parser is deliberately
 * generous: it recognises a receipt by "Umepokea" / "You have received" / "received", pulls the first
 * TZS/Tsh amount, a transaction id (6-12 letters/digits after words like "Muamala", "Txn", "Trans",
 * "Transaction ID", or a leading code), and the payer's name and masked number when present.
 * Anything it cannot read is recorded as "unparsed" with the raw SMS so the format can be added later.
 */
object TzParser {
    data class Result(
        val ok: Boolean,
        val reason: String? = null,
        val amount: Int = 0,
        val amountExact: Double = 0.0,
        val payerName: String? = null,
        val payerLast: String? = null,
        val payerMasked: String? = null,
        val txnId: String? = null,
        val paidAt: String? = null,
        val wallet: String? = null,
        val raw: String = ""
    )

    private val received = Regex("\\b(umepokea|you have received|received|imepokelewa)\\b", RegexOption.IGNORE_CASE)
    private val amountRx = Regex("(?:TZS|Tsh\\.?|TSh\\.?|Sh\\.?)\\s*([\\d,]+(?:\\.\\d{1,2})?)|([\\d,]+(?:\\.\\d{1,2})?)\\s*(?:TZS|Tsh\\.?|TSh\\.?)", RegexOption.IGNORE_CASE)
    private val txnRx = listOf(
        Regex("(?:muamala|transaction id|transaction|txn id|txn|trans id|trans|ref(?:erence)?|kumbukumbu)\\s*(?:no\\.?|number|namba)?\\s*[:#.]?\\s*([A-Z0-9][A-Z0-9.\\-]{5,15})", RegexOption.IGNORE_CASE),
        Regex("^([A-Z0-9]{8,12})\\b")
    )
    private val fromRx = Regex("(?:kutoka|from)\\s+(?:kwa\\s+)?(.+?)\\s*[,(]?\\s*(\\+?[0-9][0-9*xX]{6,})", RegexOption.IGNORE_CASE)

    fun wallet(sender: String, body: String): String {
        val s = (sender + " " + body).lowercase()
        return when {
            "tigo" in s || "mixx" in s || "yas" in s -> "Tigo Pesa"
            "airtel" in s -> "Airtel Money"
            "halo" in s -> "HaloPesa"
            "m-pesa" in s || "mpesa" in s || "vodacom" in s -> "M-Pesa"
            else -> "Mobile money"
        }
    }

    fun parse(body: String, sender: String = ""): Result {
        val text = body.replace(' ', ' ').replace(Regex("\\s+"), " ").trim()
        if (!received.containsMatchIn(text)) return Result(false, "not an incoming payment", raw = body)
        val am = amountRx.find(text) ?: return Result(false, "amount not found", raw = body)
        val v = (am.groupValues[1].ifEmpty { am.groupValues[2] }).replace(",", "").toDoubleOrNull()
            ?: return Result(false, "bad amount", raw = body)
        if (v <= 0) return Result(false, "bad amount", raw = body)
        val txn = txnRx.firstNotNullOfOrNull { it.find(text)?.groupValues?.get(1) }?.uppercase()?.trimEnd('.')
            ?: return Result(false, "transaction code not found", raw = body)
        val fm = fromRx.find(text)
        val name = fm?.groupValues?.get(1)?.trim()?.takeIf { it.length in 2..60 }
        val masked = fm?.groupValues?.get(2)
        val last = masked?.let { Regex("(\\d{3,4})$").find(it)?.groupValues?.get(1) }
        return Result(true, amount = v.toInt(), amountExact = v, payerName = name, payerLast = last, payerMasked = masked,
            txnId = txn, paidAt = null, wallet = wallet(sender, body), raw = body)
    }
}
