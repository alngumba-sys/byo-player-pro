-- ============================================================================
-- BYO Player Pro — telebirr payment collection (Ethiopia), run via Hulet Limited
-- Backend schema: plans, devices, pending activations, payments, subscriptions.
--
-- Matching model (no memo field, no cents):
--   A confirmed payment is identified by (exact whole-birr amount + payer last-4)
--   within a time window, and every telebirr transaction id is globally unique so
--   no payment is ever counted twice. Amounts are varied by whole birr only when
--   two PENDING activations share the same payer last-4, so the (amount,last4)
--   pair stays unique among what is currently outstanding.
--
-- Safety rules encoded here:
--   * Exact total required — underpayment never activates; balance is tracked.
--   * Unpaid pendings expire after 10 min; PARTIALLY paid ones never auto-expire.
--   * txn_id UNIQUE — replay/reuse impossible.
--   * Ambiguity (collision + partial, or no single match) -> manual review, never
--     auto-activate.
--   * A confirmed subscription binds to the TV DEVICE (one payment, one TV).
-- ============================================================================

create schema if not exists byo;

-- ---------------------------------------------------------------------------
-- PLANS — admin-editable. Price + duration are data, never hardcoded.
-- ---------------------------------------------------------------------------
create table if not exists byo.plans (
    id           uuid primary key default gen_random_uuid(),
    code         text unique not null,              -- e.g. 'test_1m'
    name         text not null,                     -- shown on the TV
    price_etb    integer not null check (price_etb > 0),   -- whole birr (base amount)
    duration_days integer not null check (duration_days > 0),
    sort_order   integer not null default 0,
    active       boolean not null default true,     -- admin can disable without deleting
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

-- Seed the test plans (admin can change amounts/durations anytime).
insert into byo.plans (code, name, price_etb, duration_days, sort_order) values
    ('test_1m', '1 Month',  5,  30, 1),
    ('test_2m', '2 Months', 10, 60, 2),
    ('test_3m', '2 Months', 20, 60, 3)   -- NOTE: 20 birr set to 60 days per spec; change to 90 in admin if 3 months intended
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- DEVICES — the TVs. Reuses BYO Player Pro's existing device identity.
-- ---------------------------------------------------------------------------
create table if not exists byo.devices (
    id          uuid primary key default gen_random_uuid(),
    device_id   text unique not null,               -- the TV's stable id from pairing
    label       text,                               -- optional friendly name
    country     text,                               -- e.g. 'ET'
    last_seen   timestamptz,
    created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- SUBSCRIPTIONS — the unlock state bound to a DEVICE. One active row per device.
-- ---------------------------------------------------------------------------
create table if not exists byo.subscriptions (
    id          uuid primary key default gen_random_uuid(),
    device_id   text not null references byo.devices(device_id) on delete cascade,
    plan_id     uuid references byo.plans(id),
    status      text not null default 'inactive'
                 check (status in ('inactive','active','expired')),
    activated_at timestamptz,
    expires_at   timestamptz,
    updated_at   timestamptz not null default now()
);
create unique index if not exists subscriptions_one_per_device
    on byo.subscriptions(device_id);

-- ---------------------------------------------------------------------------
-- PENDING ACTIVATIONS — a subscriber has chosen a plan and been told an exact
-- whole-birr amount to send. We wait for the telebirr SMS to confirm it.
--
--   required_amount : the (possibly bumped) whole-birr amount they must send IN TOTAL
--   paid_amount     : running total received so far (supports top-ups)
--   payer_last4     : last 4 digits of the phone they said they'll pay from
--   status          : awaiting | partial | matched | expired | review
-- ---------------------------------------------------------------------------
create table if not exists byo.pending_activations (
    id              uuid primary key default gen_random_uuid(),
    device_id       text not null references byo.devices(device_id) on delete cascade,
    plan_id         uuid not null references byo.plans(id),
    payer_last4     text not null check (payer_last4 ~ '^[0-9]{4}$'),
    payer_phone     text,                           -- full number as entered on TV (optional)
    required_amount integer not null check (required_amount > 0),  -- whole birr
    paid_amount     integer not null default 0 check (paid_amount >= 0),
    status          text not null default 'awaiting'
                     check (status in ('awaiting','partial','matched','expired','review')),
    created_at      timestamptz not null default now(),
    expires_at      timestamptz not null,           -- created_at + 10 min (unpaid only)
    matched_at      timestamptz,
    updated_at      timestamptz not null default now()
);

-- Fast lookup for the matcher: find the outstanding pending(s) for an (amount,last4).
create index if not exists pending_match_idx
    on byo.pending_activations(payer_last4, required_amount, status);
-- Allocator needs all amounts currently reserved for a last4.
create index if not exists pending_last4_open_idx
    on byo.pending_activations(payer_last4, status)
    where status in ('awaiting','partial');

-- A device can have only ONE outstanding pending at a time (prevents slot churn).
create unique index if not exists pending_one_open_per_device
    on byo.pending_activations(device_id)
    where status in ('awaiting','partial');

-- ---------------------------------------------------------------------------
-- PAYMENTS — every telebirr receipt the collector phone forwards. txn_id is the
-- global anti-replay key: each telebirr transaction can be ingested exactly once.
-- We keep the raw SMS so a parser change can be re-run and nothing is lost.
-- ---------------------------------------------------------------------------
create table if not exists byo.payments (
    id            uuid primary key default gen_random_uuid(),
    txn_id        text unique not null,             -- telebirr transaction number — UNIQUE
    amount        integer not null check (amount > 0),  -- whole birr (floor of received)
    amount_raw    numeric(14,2),                    -- exact value as parsed (e.g. 5.00)
    payer_name    text,
    payer_last4   text check (payer_last4 ~ '^[0-9]{4}$'),
    paid_at       timestamptz,                      -- timestamp from the SMS
    balance_after numeric(14,2),                    -- telebirr account balance (audit)
    raw_text      text not null,                    -- full SMS, verbatim
    source        text not null default 'telebirr-sms',
    -- resolution:
    pending_id    uuid references byo.pending_activations(id),
    outcome       text not null default 'unresolved'
                  check (outcome in ('unresolved','applied','review','ignored')),
    received_at   timestamptz not null default now()
);
create index if not exists payments_outcome_idx on byo.payments(outcome);

-- ---------------------------------------------------------------------------
-- updated_at touch triggers
-- ---------------------------------------------------------------------------
create or replace function byo.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists t_plans_touch on byo.plans;
create trigger t_plans_touch before update on byo.plans
    for each row execute function byo.touch_updated_at();
drop trigger if exists t_subs_touch on byo.subscriptions;
create trigger t_subs_touch before update on byo.subscriptions
    for each row execute function byo.touch_updated_at();
drop trigger if exists t_pending_touch on byo.pending_activations;
create trigger t_pending_touch before update on byo.pending_activations
    for each row execute function byo.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — lock everything down. All real work goes through SECURITY DEFINER RPCs
-- (next migration) called with the service role from the API. Anon/authenticated
-- clients get NO direct table access.
-- ---------------------------------------------------------------------------
alter table byo.plans               enable row level security;
alter table byo.devices             enable row level security;
alter table byo.subscriptions       enable row level security;
alter table byo.pending_activations enable row level security;
alter table byo.payments            enable row level security;

-- Public read of ACTIVE plans only (the TV lists plans). Nothing else is public.
drop policy if exists plans_public_read on byo.plans;
create policy plans_public_read on byo.plans
    for select using (active = true);
