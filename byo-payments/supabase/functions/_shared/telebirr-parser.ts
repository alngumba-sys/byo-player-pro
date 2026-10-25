// telebirr receipt-SMS parser (Deno/TS port). Mirrors api/telebirr-parser.js 1:1.
// Only reads the SMS BODY — the sender-ID "telebirr" check happens before this,
// in the Android app and re-checked in the ingest function.

export interface ParsedOk {
  ok: true;
  amount: number;        // whole birr — what the matcher keys on
  amountExact: number;   // exact value (e.g. 5.00)
  payerName: string | null;
  payerLast4: string;
  txnId: string;
  paidAt: string | null; // ISO, EAT (+03:00)
  balanceAfter: number | null;
  raw: string;
}
export interface ParsedErr { ok: false; reason: string; raw: string; }
export type Parsed = ParsedOk | ParsedErr;

function normalise(s: string): string {
  return String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}
function parseMoney(str: string): { whole: number; exact: number } | null {
  const exact = parseFloat(String(str).replace(/,/g, ""));
  if (!isFinite(exact)) return null;
  return { whole: Math.floor(exact), exact };
}
function extractLast4(masked: string): string | null {
  const m = String(masked).match(/(\d{4})\s*\)?\s*$/);
  return m ? m[1] : null;
}

export function parseTelebirrReceipt(body: string): Parsed {
  const raw = String(body ?? "");
  const text = normalise(raw);

  if (!/you have received/i.test(text)) return { ok: false, reason: "not an incoming receipt", raw };

  const amtM = text.match(/received\s+ETB\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!amtM) return { ok: false, reason: "amount not found", raw };
  const amount = parseMoney(amtM[1]);
  if (!amount || amount.exact <= 0) return { ok: false, reason: "bad amount", raw };

  const fromM = text.match(/from\s+(.+?)\s*\(([0-9*]+)\)/i);
  const payerName = fromM ? fromM[1].trim() : null;
  const payerLast4 = fromM ? extractLast4(fromM[2]) : null;
  if (!payerLast4) return { ok: false, reason: "payer last4 not found", raw };

  const txnM = text.match(/transaction number is\s+([A-Z0-9]+)/i);
  if (!txnM) return { ok: false, reason: "txn id not found", raw };
  const txnId = txnM[1].toUpperCase();

  const dtM = text.match(/on\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  let paidAt: string | null = null;
  if (dtM) {
    const [, dd, mm, yyyy, HH, MM, SS] = dtM;
    paidAt = `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}+03:00`;
  }

  const balM = text.match(/balance is\s+ETB\s*([\d,]+(?:\.\d{1,2})?)/i);
  const balanceAfter = balM ? (parseMoney(balM[1])?.exact ?? null) : null;

  return { ok: true, amount: amount.whole, amountExact: amount.exact, payerName, payerLast4, txnId, paidAt, balanceAfter, raw };
}
