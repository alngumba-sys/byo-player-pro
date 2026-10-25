// POST { device_id, plan_code, country, currency }
// Creates a hosted card checkout and returns { ok, checkout_url }. The app opens it in the browser
// and polls billing-status until payment-webhook marks the intent paid.
//
// TODO(integration): pick a card provider that pays out where you bank (e.g. Flutterwave or Paystack
// for Kenya, Stripe elsewhere) and implement createCheckout() below. Until CARD_PROVIDER is set this
// returns { ok:false, error:'not_configured' } and the app shows "Card payments are being set up".
import { serviceClient, json, preflight, badRequest } from "../_shared/util.ts";
import { priceOf } from "../_shared/billing.ts";

async function createCheckout(provider: string, o: { ref: string; amount_minor: number; currency: string; device_id: string; plan_code: string }):
  Promise<{ url: string; provider_ref: string } | null> {
  // Example shape for Flutterwave Standard (fill FLW_SECRET_KEY + CARD_REDIRECT_URL):
  // const r = await fetch("https://api.flutterwave.com/v3/payments", { method:"POST",
  //   headers:{ Authorization:"Bearer "+Deno.env.get("FLW_SECRET_KEY"), "content-type":"application/json" },
  //   body: JSON.stringify({ tx_ref:o.ref, amount:o.amount_minor/100, currency:o.currency, payment_options:"card",
  //     redirect_url:Deno.env.get("CARD_REDIRECT_URL"), customer:{ email:`${o.device_id}@devices.byoplayer.com` },
  //     meta:{ device_id:o.device_id, plan_code:o.plan_code } }) });
  // const j = await r.json(); return j?.data?.link ? { url:j.data.link, provider_ref:o.ref } : null;
  return null;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  let b: any = {}; try { b = await req.json(); } catch { /* empty */ }
  const device_id = String(b.device_id ?? "").trim(), plan_code = String(b.plan_code ?? "");
  const country = String(b.country ?? "").toUpperCase();
  if (!device_id || !plan_code) return badRequest("device_id and plan_code required");
  const provider = Deno.env.get("CARD_PROVIDER");
  if (!provider) return json({ ok: false, error: "not_configured" }, 200);

  const db = serviceClient();
  const price = await priceOf(db, country, plan_code);
  if (!price) return badRequest("Unknown plan");
  const ref = "byo_" + crypto.randomUUID();
  const co = await createCheckout(provider, { ref, ...price, device_id, plan_code });
  if (!co) return json({ ok: false, error: "not_configured" }, 200);
  await db.from("payment_intents").insert({ device_id, plan_code, method: "card", country, currency: price.currency,
    amount_minor: price.amount_minor, provider, provider_ref: co.provider_ref, checkout_url: co.url, status: "pending" });
  return json({ ok: true, checkout_url: co.url });
});
