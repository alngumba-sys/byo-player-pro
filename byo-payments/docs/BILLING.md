# BYO Player Pro: trial and payments

BYO Player Pro sells the PLAYER, not content. Users always bring their own playlist.

## What a new user experiences
1. Language, then country (auto-detected).
2. "Add your playlist": paste an M3U link (Paste button), or Xtream login, or Emby/Jellyfin.
   Or "Start with free channels" (public Free-TV list of free-to-air channels), or set up from another phone by QR.
3. The 3-day free trial of the app starts; Home opens with their channels.
   Home shows a quiet "Free trial · N days left · Subscribe" banner.
4. When the trial ends, a payment wall covers the app (on launch, content tabs, play):
   Ethiopia telebirr (existing flow), Kenya M-Pesa or card, everyone else card.

## Server pieces (Supabase, schema `byo`)
- `migrations/0003_onboarding_billing.sql`: `app_config.trial_days` (3), `devices.trial_started_at`,
  `prices` (placeholder KES/USD), `payment_intents`, RPCs `device_start`, `billing_status`,
  `grant_subscription`, `complete_intent`.
- Edge functions: `device-start`, `billing-status`, `mpesa-stk-push`, `card-checkout`, `payment-webhook`.

## To finish later
1. Expose the `byo` schema in Supabase API settings, run the migration, deploy the functions.
2. Set real prices in `byo.prices`.
3. M-Pesa: set the `MPESA_*` secrets (Daraja). STK push code is written; verify callbacks before go-live.
4. Cards: choose a provider, set `CARD_PROVIDER` + keys, implement `createCheckout` and webhook verification.
Until 3 and 4 are done the app shows "M-Pesa/Card payments are being set up".
