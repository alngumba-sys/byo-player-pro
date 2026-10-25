// POST { device_id, plan_code, phone: '2547XXXXXXXX', country }
// Kenya only. Creates a payment intent and sends an M-Pesa STK push (Safaricom Daraja).
// Until the MPESA_* secrets are set this returns { ok:false, error:'not_configured' } and the app
// shows "M-Pesa payments are being set up".
//
// TODO(integration): fill the secrets below and confirm the Daraja endpoints for your shortcode.
//   MPESA_ENV=sandbox|production  MPESA_CONSUMER_KEY  MPESA_CONSUMER_SECRET
//   MPESA_SHORTCODE  MPESA_PASSKEY  MPESA_CALLBACK_URL (= .../functions/v1/payment-webhook?provider=daraja)
import { serviceClient, json, preflight, badRequest } from "../_shared/util.ts";
import { priceOf } from "../_shared/billing.ts";

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  let b: any = {}; try { b = await req.json(); } catch { /* empty */ }
  const device_id = String(b.device_id ?? "").trim(), plan_code = String(b.plan_code ?? "");
  const phone = String(b.phone ?? "").replace(/\D/g, "");
  if (!device_id || !plan_code) return badRequest("device_id and plan_code required");
  if (!/^254[17]\d{8}$/.test(phone)) return badRequest("Enter a valid Safaricom number");

  const key = Deno.env.get("MPESA_CONSUMER_KEY"), secret = Deno.env.get("MPESA_CONSUMER_SECRET");
  const shortcode = Deno.env.get("MPESA_SHORTCODE"), passkey = Deno.env.get("MPESA_PASSKEY"), callback = Deno.env.get("MPESA_CALLBACK_URL");
  if (!key || !secret || !shortcode || !passkey || !callback) return json({ ok: false, error: "not_configured" }, 200);

  const db = serviceClient();
  const price = await priceOf(db, "KE", plan_code);
  if (!price || price.currency !== "KES") return badRequest("Unknown plan");
  const host = Deno.env.get("MPESA_ENV") === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

  // 1) OAuth token
  const tok = await fetch(host + "/oauth/v1/generate?grant_type=client_credentials", { headers: { Authorization: "Basic " + btoa(key + ":" + secret) } });
  if (!tok.ok) return json({ ok: false, error: "M-Pesa is not reachable right now. Try again." }, 502);
  const access = (await tok.json()).access_token;

  // 2) STK push
  const ts = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const amount = Math.round(price.amount_minor / 100);
  const res = await fetch(host + "/mpesa/stkpush/v1/processrequest", {
    method: "POST", headers: { Authorization: "Bearer " + access, "content-type": "application/json" },
    body: JSON.stringify({ BusinessShortCode: shortcode, Password: btoa(shortcode + passkey + ts), Timestamp: ts, TransactionType: "CustomerPayBillOnline",
      Amount: amount, PartyA: phone, PartyB: shortcode, PhoneNumber: phone, CallBackURL: callback, AccountReference: "BYO Player", TransactionDesc: plan_code }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ResponseCode !== "0") return json({ ok: false, error: out.errorMessage ?? out.CustomerMessage ?? "Could not send the M-Pesa request." }, 200);

  await db.from("payment_intents").insert({ device_id, plan_code, method: "mpesa", country: "KE", currency: "KES",
    amount_minor: price.amount_minor, phone, provider: "daraja", provider_ref: out.CheckoutRequestID, status: "pending", raw: out });
  return json({ ok: true, checkout_request_id: out.CheckoutRequestID });
});
