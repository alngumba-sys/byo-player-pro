// GET /activation-status?device_id=...   (the TV polls this every few seconds)
//   or POST { device_id }
//
// Returns the live state for the TV to render:
//   { ok, state, amount, paid, balance_due, expires_in_sec, sub_expires_at, unlocked }
//
//   state: 'active'   -> unlocked = true  (show Movies/Live/Series)
//          'awaiting' -> "Send exactly ETB <amount> to <number>"
//          'partial'  -> "Received ETB <paid>. Balance due ETB <balance_due>."
//          'expired'  -> "Time's up — start again."
//          'none'     -> no pending; show plan picker.
//
// No secret needed: this only reveals a device's own subscription state, keyed by a
// device id the TV already owns. It never grants anything — activation happens only
// via a matched telebirr payment on the server.

import { serviceClient, json, preflight, badRequest } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  let device_id = "";
  if (req.method === "GET") {
    device_id = new URL(req.url).searchParams.get("device_id") ?? "";
  } else if (req.method === "POST") {
    try { device_id = String((await req.json())?.device_id ?? ""); } catch { /* ignore */ }
  } else {
    return json({ ok: false, error: "GET or POST only" }, 405);
  }
  device_id = device_id.trim();
  if (!device_id) return badRequest("device_id required");

  const db = serviceClient();
  const { data, error } = await db.rpc("activation_status", { p_device_id: device_id });
  if (error) return json({ ok: false, error: error.message }, 400);

  const row = Array.isArray(data) ? data[0] : data;
  const state = row?.state ?? "none";
  const expiresMs = row?.expires_at ? new Date(row.expires_at).getTime() - Date.now() : null;

  return json({
    ok: true,
    state,
    unlocked: state === "active",
    amount: row?.required_amount ?? null,
    paid: row?.paid_amount ?? null,
    balance_due: row?.balance_due ?? null,
    expires_in_sec: expiresMs != null ? Math.max(0, Math.floor(expiresMs / 1000)) : null,
    sub_expires_at: row?.sub_expires_at ?? null,
  });
});
