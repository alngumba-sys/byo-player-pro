// POST /admin  —  used by the Next.js admin dashboard (service-to-service).
// Auth: x-api-key must equal ADMIN_API_KEY.
// Body: { action: string, ...args }
//
// Actions:
//   plans.list                                   -> all plans (incl. inactive)
//   plans.upsert  {id?, code, name, price_etb, duration_days, sort_order, active}
//   plans.disable {id}                           -> active=false
//   review.queue                                 -> payments needing a human
//   review.apply  {payment_id, pending_id}       -> attach + maybe activate
//   subs.list                                    -> active subscriptions
//   payments.recent {limit?}                     -> recent payments (audit)
//
// Remote support (the customer opens "Get remote help" on the TV and reads out a 4-digit code):
//   support.claim  {code, agent}                 -> connect to that TV's session
//   support.status {session_id}                  -> session, TV snapshot, billing, flags, commands
//   support.send   {session_id, kind, payload, secret?, agent}
//                   kinds: connection.add | connection.remove | settings | message |
//                          refresh | signout
//   support.trial  {session_id, days, agent}     -> add free days to this TV's trial
//   support.flags  {session_id, flags, agent}    -> switch app sections on/off for this TV
//   support.end    {session_id, agent}
//   support.recent {limit?}                      -> latest sessions
//   support.active                               -> every TV support is connected to, with time left
//   support.extend {session_id}                  -> +30 minutes (max 3 hours)
//   support.access {session_id, state, days?}    -> enable N days / end now / block / clear
//   fleet.list {q?, filter?, limit?}             -> every TV that has checked in, with status
//   fleet.access {device_key, state, days?}      -> enable / disable / end / clear any TV (no code)
//   (any other support.* / fleet.* action is passed straight to the SQL function)
//
// Everything financial still runs through the SECURITY DEFINER RPCs; the dashboard
// never writes payment/subscription rows directly.

import { serviceClient, json, preflight, checkApiKey } from "../_shared/util.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


// Remote support runs through ONE SQL function in the public schema that only the service
// role may execute (0007_support_admin_rpc.sql), so the byo schema never has to be exposed.
function publicClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}
async function support(action: string, b: any) {
  const { data, error } = await publicClient().rpc("byo_support_admin", { p_action: action, p_args: b ?? {} });
  if (error) return json({ ok: false, error: error.message }, 400);
  const out = data ?? { ok: false, error: "no response" };
  return json(out, out.ok ? 200 : 400);
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!checkApiKey(req, "ADMIN_API_KEY")) return json({ ok: false, error: "unauthorized" }, 401);

  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const db = serviceClient();
  const action = String(b?.action ?? "");

  try {
    switch (action) {
      case "plans.list": {
        const { data, error } = await db.from("plans").select("*").order("sort_order");
        if (error) throw error;
        return json({ ok: true, plans: data });
      }
      case "plans.upsert": {
        const row = {
          id: b.id ?? undefined,
          code: b.code, name: b.name,
          price_etb: b.price_etb, duration_days: b.duration_days,
          sort_order: b.sort_order ?? 0,
          active: b.active ?? true,
        };
        const { data, error } = await db.from("plans").upsert(row, { onConflict: "code" }).select();
        if (error) throw error;
        return json({ ok: true, plan: data?.[0] });
      }
      case "plans.disable": {
        const { error } = await db.from("plans").update({ active: false }).eq("id", b.id);
        if (error) throw error;
        return json({ ok: true });
      }
      case "review.queue": {
        const { data, error } = await db.rpc("review_queue");
        if (error) throw error;
        return json({ ok: true, items: data });
      }
      case "review.apply": {
        const { error } = await db.rpc("admin_apply_payment", {
          p_payment: b.payment_id, p_pending: b.pending_id,
        });
        if (error) throw error;
        return json({ ok: true });
      }
      case "subs.list": {
        const { data, error } = await db
          .from("subscriptions")
          .select("device_id, status, activated_at, expires_at, plan_id")
          .order("activated_at", { ascending: false });
        if (error) throw error;
        return json({ ok: true, subscriptions: data });
      }
      case "payments.recent": {
        const limit = Math.min(Number(b.limit ?? 100), 500);
        const { data, error } = await db
          .from("payments")
          .select("txn_id, amount, payer_last4, payer_name, outcome, received_at")
          .order("received_at", { ascending: false })
          .limit(limit);
        if (error) throw error;
        return json({ ok: true, payments: data });
      }
      // ---------------- remote support ----------------
      case "support.claim": case "support.status": case "support.send": case "support.trial":
      case "support.flags": case "support.end": case "support.recent": case "support.active": case "support.extend": case "support.access":
        return await support(action, b);
      default:
        // Any other support / fleet action is handled by the SQL function, so new ones need no redeploy.
        if (/^(support|fleet)\.[a-z_.]+$/.test(action)) return await support(action, b);
        return json({ ok: false, error: `unknown action '${action}'` }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: String(e?.message ?? e) }, 400);
  }
});
