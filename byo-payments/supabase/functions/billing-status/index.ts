// POST { device_id } -> { ok, state, trial_ends_at, sub_expires_at }   (the app polls this while a payment is pending)
import { serviceClient, json, preflight, badRequest } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  let device_id = "";
  try { device_id = String((await req.json())?.device_id ?? "").trim(); } catch { /* empty */ }
  if (!device_id) return badRequest("device_id required");
  const db = serviceClient();
  const { data, error } = await db.rpc("billing_status", { p_device_id: device_id });
  if (error) return json({ ok: false, error: error.message }, 400);
  const row = Array.isArray(data) ? data[0] : data;
  return json({ ok: true, state: row?.state ?? "expired", trial_ends_at: row?.trial_ends_at, sub_expires_at: row?.sub_expires_at });
});
