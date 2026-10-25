# Remote help: backend setup (one time)

The TV app (3.34.0+) and the support console need two backend changes on the
BYO Supabase project (lkftnbkuuitaxtlvrqfj). Until they are in place, the TV
shows "Could not reach BYO support" when someone taps Get remote help.

## 1. Run the migrations

Supabase dashboard -> SQL Editor -> New query -> paste all of
`supabase/migrations/0006_remote_support.sql` -> Run.
Then the same for `supabase/migrations/0007_support_admin_rpc.sql`, then `0008_support_multi.sql`, then `0009_support_access.sql`, then `0010_fleet.sql`, `0011_fleet_country.sql`, `0012_payments.sql` and `0013_fleet_details.sql`.

Do NOT add the `byo` schema to "Exposed schemas" in the API settings: the admin
function reaches the support tables through one locked-down function instead.

It adds the support tables, the TV-side functions (byo_support_open / poll /
ack / end, byo_device_flags) and lets support add trial days. Safe to run more
than once.

## 2. Deploy the updated admin function

From this folder (`byo-payments`), with the Supabase CLI logged in:

    supabase functions deploy admin --project-ref lkftnbkuuitaxtlvrqfj --no-verify-jwt

The admin key is the existing ADMIN_API_KEY secret. If it was never set:

    supabase secrets set ADMIN_API_KEY=<a long random string> --project-ref lkftnbkuuitaxtlvrqfj

Keep that key private: it is what support signs in with.

## 3. Use it

Support console: https://byoplayer-pair.netlify.app/support/
Sign in with your name and the admin key, then type the customer's 4-digit code.

## What support can do

- Add a connection (Xtream, M3U, Emby, Jellyfin), optionally keeping the others
- Remove a connection, refresh the library, or sign the TV out of all connections
- Change language, turn parental controls on/off, set a new PIN, lock Settings
- Show a message on the TV
- Add (or remove) free trial days
- Hide or show app sections (Live, Sports, Movies, Series, Guide, AI assistant)

Every change shows on the TV and comes back to the console as done or error.

## Safety

- Nothing happens until the customer opens Get remote help and shares the code.
- Codes expire after 15 minutes; a connected session ends after 60 minutes.
  The customer can press End help at any time.
- The TV holds a secret session token; only that TV can collect its commands.
- Passwords are kept only until the TV collects them (seconds), then wiped.
  The console never shows passwords or playlist links.
- Every action is logged in byo.support_audit (who, what, when).

## All TVs (3.35.0+, needs 0010_fleet.sql and the admin function redeployed once)

Every TV running 3.35.0 or newer checks in when the app opens, when it comes back
on screen, and every 15 minutes. The console's "All TVs" button lists them with no
code needed: TV ID (also shown on the TV in Settings > About and on the paused
screen), model, country, language, app version, trial or subscription status,
library size and when it was last seen.

From the list support can Enable a TV for 30 days to 1 year, Disable it (the TV
shows "BYO Player is paused on this TV"), Unblock it, or Reset it to its normal
trial or subscription. A change shows "waiting for TV" until the TV next checks in.

The check-in holds no names, emails, playlists, server addresses or passwords:
only the device key, app details, counts and status. Mention it in the privacy
policy as "device and app diagnostics used for support and licensing".

From now on the admin function forwards any `support.*` or `fleet.*` action to the
SQL function, so new actions of that kind only need a migration, not a redeploy.

## Payments by M-Pesa and telebirr (TV 3.36.0+, Collector 1.4+, needs 0012_payments.sql)

1. Run `0012_payments.sql` in the SQL Editor. No admin redeploy is needed.
2. Console > Payments: set the number customers pay to (Kenya M-Pesa, Ethiopia telebirr),
   the name they will see, and the plans and prices. Untick a plan to hide it on the TV.
3. Console > Payments > New key, then type that key into BYO Collector > Settings >
   Connection key. Saving the receiving numbers in the Collector also updates them here.

How a payment is matched: the customer picks a plan on the TV and types the number they
will pay from. When the collector phone reads "You have received ..." it reports the
amount, reference and the payer digits the SMS shows (e.g. 0114***089). The backend finds
the TV waiting for a payment from a number starting 0114 and ending 089, checks the amount
is at least the plan price, and turns the TV on for the plan's days (added to time left).
Payments that match no TV, or are too small, show in Console > Payments for follow-up.
A TV disabled by support stays disabled; its payment is kept and marked "TV disabled".
