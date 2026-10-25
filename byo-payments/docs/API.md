# BYO Player Pro — Payments API (Supabase Edge Functions)

Base URL: `https://<project-ref>.functions.supabase.co`

All money rules live in Postgres SECURITY DEFINER RPCs (`byo.ingest_payment`,
`byo.start_activation`, `byo.activation_status`). These functions are a thin,
authenticated HTTP layer over them. A client can never grant itself access —
activation happens only when a matched telebirr payment reaches the server.

---

## 1. `POST /start-activation`  (called by the TV)

The user in Ethiopia picked a plan and typed the phone they'll pay from.

Request:
```json
{ "device_id": "TV-ABC123", "plan_code": "test_1m", "phone": "0913028610" }
```
Response:
```json
{
  "ok": true,
  "pending_id": "…",
  "telebirr_number": "0913028610",
  "amount": 5,
  "plan_name": "1 Month",
  "plan_price": 5,
  "payer_last4": "8610",
  "expires_at": "2026-10-05T16:14:25+03:00",
  "expires_in_sec": 600
}
```
TV shows: **“Send exactly ETB 5 to 0913028610”** + a 10-minute countdown, then
polls `/activation-status`.

---

## 2. `GET /activation-status?device_id=TV-ABC123`  (TV polls every ~4s)

Response examples:
```json
{ "ok": true, "state": "awaiting", "amount": 5, "paid": 0, "balance_due": 5, "expires_in_sec": 540, "unlocked": false }
{ "ok": true, "state": "partial",  "amount": 6, "paid": 4, "balance_due": 2, "expires_in_sec": 300, "unlocked": false }
{ "ok": true, "state": "active",   "unlocked": true, "sub_expires_at": "2026-11-04T16:04:25+03:00" }
{ "ok": true, "state": "expired",  "unlocked": false }
{ "ok": true, "state": "none",     "unlocked": false }
```
`unlocked:true` → TV enables Movies, Live TV, Series.

---

## 3. `POST /ingest-sms`  (called by the Android collector phone)

Header: `x-api-key: <COLLECTOR_API_KEY>`

Single or batch:
```json
{ "sender": "telebirr", "body": "You have received ETB 5.00 from …" }
```
```json
{ "messages": [ { "sender": "telebirr", "body": "…" }, { "sender": "telebirr", "body": "…" } ] }
```
Response:
```json
{ "ok": true, "count": 1, "results": [ { "txnId": "REALTXN01", "result": "activated", "detail": "paid 5 of 5" } ] }
```
`result` ∈ `activated | activated_overpaid | partial | review | duplicate | rejected | error`.
`rejected` = untrusted sender or unparseable body (never reaches the matcher).

---

## 4. `POST /admin`  (called by the Next.js dashboard)

Header: `x-api-key: <ADMIN_API_KEY>`. Body `{ "action": "...", ... }`.

| action | args | returns |
|---|---|---|
| `plans.list` | — | all plans |
| `plans.upsert` | code, name, price_etb, duration_days, sort_order, active | plan |
| `plans.disable` | id | ok |
| `review.queue` | — | payments needing a human |
| `review.apply` | payment_id, pending_id | ok (+maybe activates) |
| `subs.list` | — | active subscriptions |
| `payments.recent` | limit? | recent payments (audit) |

---

## Deploy

```bash
# one-time
supabase link --project-ref <ref>
supabase db push                              # applies 0001_schema.sql, 0002_functions.sql
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy ingest-sms start-activation activation-status admin
```
