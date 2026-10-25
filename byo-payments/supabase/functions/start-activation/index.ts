// POST /start-activation  —  called by the TV when the user (in Ethiopia) picks a
// plan and enters the phone number they'll pay from.
//
// Body:  { device_id: string, plan_code: string, phone: string }
//        phone is the full MSISDN the user will pay from; we derive last4 from it.
// Auth:  the Supabase anon key (standard apikey header) is enough — the RPC is the
//        gatekeeper and this endpoint only creates a pending, never grants access.
//
// Returns: { ok, pending_id, telebirr_number, amount, plan_name, expires_at, expires_in_sec }
// The TV shows: "Send exactly ETB <amount> to <telebirr_number>" + a 10-min countdown.

import { serviceClient, json, preflight, badRequest } from "../_shared/util.ts";

// The single telebirr number everyone pays to (test + prod). Set as an env/secret so
// it can change without a redeploy.
function collectionNumber(): string {
  return Deno.env.get("TELEBIRR_COLLECTION_NUMBER") ?? "0913028610";
}

// Normalise an Ethiopian number to its last 4 digits.
// Accepts 09XXXXXXXX, +2519XXXXXXXX, 2519XXXXXXXX, with spaces/dashes.
function last4(phone: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let b: any;
  try { b = await req.json(); } catch { return badRequest("bad json"); }

  const device_id = String(b?.device_id ?? "").trim();
  const plan_code = String(b?.plan_code ?? "").trim();
  const phone = String(b?.phone ?? "").trim();
  if (!device_id) return badRequest("device_id required");
  if (!plan_code) return badRequest("plan_code required");
  const l4 = last4(phone);
  if (!l4) return badRequest("valid phone required");

  const db = serviceClient();
  const { data, error } = await db.rpc("start_activation", {
    p_device_id: device_id,
    p_plan_code: plan_code,
    p_last4: l4,
    p_phone: phone,
  });
  if (error) return json({ ok: false, error: error.message }, 400);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return json({ ok: false, error: "no activation created" }, 500);

  const expiresMs = new Date(row.expires_at).getTime() - Date.now();
  return json({
    ok: true,
    pending_id: row.pending_id,
    telebirr_number: collectionNumber(),
    amount: row.required_amount,       // exact whole-birr amount to send
    plan_name: row.plan_name,
    plan_price: row.plan_price,
    payer_last4: l4,
    expires_at: row.expires_at,
    expires_in_sec: Math.max(0, Math.floor(expiresMs / 1000)),
  });
});
