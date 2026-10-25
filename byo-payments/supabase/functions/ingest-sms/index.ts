// POST /ingest-sms  —  called by the Android collector phone for every telebirr SMS.
//
// Auth:    x-api-key header must equal COLLECTOR_API_KEY.
// Trust:   caller must assert the SMS sender id; we re-check it is "telebirr".
// Body:    { sender: string, body: string, received_at?: string }
//          (the app may also POST a batch: { messages: [{sender, body}, ...] })
//
// Flow:    verify sender -> parse body -> call byo.ingest_payment RPC (the matcher).
// Response per message: { txnId, result, detail }  where result is one of
//          activated | activated_overpaid | partial | review | duplicate | rejected.
//
// The matcher (SECURITY DEFINER RPC) enforces every money rule; this function only
// authenticates, filters by sender, parses, and forwards.

import { serviceClient, json, preflight, checkApiKey } from "../_shared/util.ts";
import { parseTelebirrReceipt } from "../_shared/telebirr-parser.ts";

// Accept only messages whose sender id looks like the official telebirr sender.
// Samsung/Android reports it variously; telebirr uses the alphanumeric id "telebirr"
// (and sometimes "127" short code in some regions). Keep this tight.
function trustedSender(sender: string): boolean {
  const s = (sender ?? "").trim().toLowerCase();
  return s === "telebirr" || s === "127" || s === "ethio telecom";
}

async function handleOne(
  db: ReturnType<typeof serviceClient>,
  msg: { sender?: string; body?: string },
) {
  if (!trustedSender(msg.sender ?? "")) {
    return { result: "rejected", detail: `untrusted sender '${msg.sender ?? ""}'` };
  }
  const parsed = parseTelebirrReceipt(msg.body ?? "");
  if (!parsed.ok) {
    return { result: "rejected", detail: parsed.reason };
  }

  const { data, error } = await db.rpc("ingest_payment", {
    p_txn_id: parsed.txnId,
    p_amount: parsed.amount,
    p_amount_raw: parsed.amountExact,
    p_last4: parsed.payerLast4,
    p_payer_name: parsed.payerName,
    p_paid_at: parsed.paidAt,
    p_balance: parsed.balanceAfter,
    p_raw_text: parsed.raw,
  });
  if (error) return { txnId: parsed.txnId, result: "error", detail: error.message };

  // RPC returns a single row { outcome, detail, pending_id }
  const row = Array.isArray(data) ? data[0] : data;
  return { txnId: parsed.txnId, result: row?.outcome ?? "unknown", detail: row?.detail ?? null };
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!checkApiKey(req, "COLLECTOR_API_KEY")) return json({ ok: false, error: "unauthorized" }, 401);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }

  const db = serviceClient();

  // Batch or single.
  const messages: { sender?: string; body?: string }[] =
    Array.isArray(payload?.messages) ? payload.messages
    : [{ sender: payload?.sender, body: payload?.body }];

  const results = [];
  for (const m of messages) results.push(await handleOne(db, m));

  return json({ ok: true, count: results.length, results });
});
