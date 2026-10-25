// POST { device_id, country, platform, trial_started_at? }
// Registers the device, starts its free trial once, and returns everything the app needs:
//   { ok, state: 'trial'|'active'|'expired', trial_ends_at, sub_expires_at, methods, currency, plans }
// The trial and subscription unlock the player only; users bring their own playlist.
import { serviceClient, json, preflight, badRequest } from "../_shared/util.ts";
import { methodsFor, pricesFor } from "../_shared/billing.ts";

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  let b: any = {}; try { b = await req.json(); } catch { /* empty */ }
  const device_id = String(b.device_id ?? "").trim(); if (!device_id) return badRequest("device_id required");
  const country = String(b.country ?? "").toUpperCase().slice(0, 2);
  const db = serviceClient();
  const { data, error } = await db.rpc("device_start", {
    p_device_id: device_id, p_country: country, p_platform: String(b.platform ?? ""), p_trial_started: b.trial_started_at ?? null,
  });
  if (error) return json({ ok: false, error: error.message }, 400);
  const row = Array.isArray(data) ? data[0] : data;
  const state = row?.state ?? "expired";
  const prices = await pricesFor(db, country);
  return json({ ok: true, state, trial_ends_at: row?.trial_ends_at, sub_expires_at: row?.sub_expires_at,
    methods: methodsFor(country), currency: prices.currency, plans: prices.plans });
});
