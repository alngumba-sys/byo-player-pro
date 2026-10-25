// ============================================================================
// telebirr receipt-SMS parser for BYO Player Pro (Ethiopia / Hulet).
//
// Built around the real receipt format:
//   "Dear <name>
//    You have received ETB 21,000.00 from ALBERT NGUMBA(2519****7421) on
//    03/10/2026 17:10:11. Your transaction number is DJ35DTF97H. Your current
//    E-Money Account balance is ETB 21,767.95.
//    Thank you for using telebirr  Ethio telecom"
//
// Extracts: amount (whole birr + exact), payerName, payerLast4 (from the masked
// number), txnId, paidAt, balanceAfter. Returns {ok:false, reason} on anything
// that doesn't look like a genuine *incoming* telebirr receipt — the matcher then
// never sees junk.
//
// SECURITY: the SENDER-ID check (only trust messages from "telebirr") happens in
// the Android app / ingestion API, NOT here. This parser only reads the body, so
// it must stay strict: if a field is missing, it fails rather than guessing.
// ============================================================================

// Normalise the many whitespace/newline variants telebirr uses into single spaces.
function normalise(s) {
  return String(s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

// "21,000.00" -> { whole: 21000, exact: 21000.00 }
function parseMoney(str) {
  const cleaned = String(str).replace(/,/g, '');
  const exact = parseFloat(cleaned);
  if (!isFinite(exact)) return null;
  return { whole: Math.floor(exact), exact };
}

// From a masked number like "2519****7421" or "251911****21" pull the LAST 4 digits.
// telebirr masks the middle, so the trailing 4 are always the real last 4 of the MSISDN.
function extractLast4(masked) {
  const digitsAtEnd = String(masked).match(/(\d{4})\s*\)?\s*$/);
  return digitsAtEnd ? digitsAtEnd[1] : null;
}

/**
 * @param {string} body raw SMS text
 * @returns {{ok:true, amount:number, amountExact:number, payerName:string,
 *            payerLast4:string, txnId:string, paidAt:string|null,
 *            balanceAfter:number|null, raw:string}
 *         | {ok:false, reason:string, raw:string}}
 */
function parseTelebirrReceipt(body) {
  const raw = String(body || '');
  const text = normalise(raw);

  // 1) Must be an INCOMING receipt ("received"), not a payment you MADE or an OTP.
  //    This rejects "You have transferred", "You have paid", balance checks, promos.
  if (!/you have received/i.test(text)) {
    return { ok: false, reason: 'not an incoming receipt', raw };
  }

  // 2) Amount received: "received ETB 21,000.00 from"
  const amtM = text.match(/received\s+ETB\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!amtM) return { ok: false, reason: 'amount not found', raw };
  const amount = parseMoney(amtM[1]);
  if (!amount || amount.exact <= 0) return { ok: false, reason: 'bad amount', raw };

  // 3) Payer name + masked number: "from ALBERT NGUMBA(2519****7421)"
  //    Name = everything between "from " and the "(". Masked number inside parens.
  const fromM = text.match(/from\s+(.+?)\s*\(([0-9*]+)\)/i);
  const payerName = fromM ? fromM[1].trim() : null;
  const payerLast4 = fromM ? extractLast4(fromM[2]) : null;
  if (!payerLast4) return { ok: false, reason: 'payer last4 not found', raw };

  // 4) Transaction number: "transaction number is DJ35DTF97H"
  const txnM = text.match(/transaction number is\s+([A-Z0-9]+)/i);
  if (!txnM) return { ok: false, reason: 'txn id not found', raw };
  const txnId = txnM[1].toUpperCase();

  // 5) Timestamp: "on 03/10/2026 17:10:11" (DD/MM/YYYY HH:MM:SS). Optional.
  const dtM = text.match(/on\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  let paidAt = null;
  if (dtM) {
    const [, dd, mm, yyyy, HH, MM, SS] = dtM;
    // Build an ISO string in East Africa Time (UTC+3) — telebirr timestamps are local.
    paidAt = `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}+03:00`;
  }

  // 6) Balance after (audit only): "balance is ETB 21,767.95". Optional.
  const balM = text.match(/balance is\s+ETB\s*([\d,]+(?:\.\d{1,2})?)/i);
  const balanceAfter = balM ? parseMoney(balM[1]).exact : null;

  return {
    ok: true,
    amount: amount.whole,       // whole birr — what the matcher keys on
    amountExact: amount.exact,  // exact value for audit (e.g. 5.00)
    payerName,
    payerLast4,
    txnId,
    paidAt,
    balanceAfter,
    raw,
  };
}

module.exports = { parseTelebirrReceipt, extractLast4, parseMoney, normalise };
