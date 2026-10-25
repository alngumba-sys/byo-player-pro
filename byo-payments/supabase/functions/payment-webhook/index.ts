// Provider callbacks land here: ?provider=daraja | flutterwave | paystack | stripe
// Each branch must VERIFY the callback (signature / re-query the provider) before calling
// byo.complete_intent, which marks the intent paid once and extends the subscription.
//
// TODO(integration): add signature verification for your card provider. Never trust the body alone.
import { serviceClient, json, preflight } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const provider = new URL(req.url).searchParams.get("provider") ?? "";
  const body: any = await req.json().catch(() => ({}));
  const db = serviceClient();

  if (provider === "daraja") {
    // Safaricom STK callback: Body.stkCallback.{CheckoutRequestID, ResultCode}
    // TODO: restrict by Safaricom callback IPs and/or re-query the transaction status before trusting.
    const cb = body?.Body?.stkCallback;
    if (!cb?.CheckoutRequestID) return json({ ResultCode: 0, ResultDesc: "ignored" });
    if (cb.ResultCode === 0) {
      await db.rpc("complete_intent", { p_provider_ref: cb.CheckoutRequestID, p_raw: body });
    } else {
      await db.from("payment_intents").update({ status: "failed", raw: body, updated_at: new Date().toISOString() })
        .eq("provider_ref", cb.CheckoutRequestID).neq("status", "paid");
    }
    return json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  // TODO: card providers. Verify first, then:
  //   await db.rpc("complete_intent", { p_provider_ref: <your tx_ref>, p_raw: body });
  return json({ ok: false, error: "provider not configured" }, 400);
});
