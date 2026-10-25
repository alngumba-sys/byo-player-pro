-- ============================================================================
-- BYO Player Pro: first-run trial of the player, global billing
-- (M-Pesa for Kenya, cards everywhere else; telebirr for Ethiopia stays in 0001/0002).
--
--   * Every new device gets a free trial (app_config.trial_days, default 3).
--   * The trial and the subscription unlock the PLAYER. Users always bring their own
--     playlist; the backend never supplies or stores content sources.
--   * After the trial the app shows a payment wall. Payments are recorded as
--     byo.payment_intents and, once a provider webhook confirms them,
--     byo.grant_subscription() extends byo.subscriptions (same table telebirr uses).
-- ============================================================================

-- ---------- config ----------
create table if not exists byo.app_config (
    key   text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now()
);
insert into byo.app_config(key, value) values ('trial_days', '3'::jsonb) on conflict (key) do nothing;

-- ---------- devices: trial clock ----------
alter table byo.devices add column if not exists trial_started_at timestamptz;
alter table byo.devices add column if not exists platform text;

-- ---------- prices per country (telebirr keeps using byo.plans.price_etb) ----------
create table if not exists byo.prices (
    id           uuid primary key default gen_random_uuid(),
    plan_code    text not null references byo.plans(code) on update cascade,
    country      text not null default '*',          -- 'KE' or '*'
    currency     text not null,                      -- 'KES', 'USD', ...
    amount_minor integer not null check (amount_minor > 0),   -- cents (KES 500 -> 50000)
    label        text,                               -- e.g. 'Best value'
    active       boolean not null default true,
    unique (plan_code, country)
);
alter table byo.prices enable row level security;

-- Plans used by M-Pesa / card (telebirr test plans already exist in 0001).
insert into byo.plans (code, name, price_etb, duration_days, sort_order) values
    ('m1',  '1 Month',   1,  30, 10),
    ('m3',  '3 Months',  1,  90, 11),
    ('m12', '12 Months', 1, 365, 12)
on conflict (code) do nothing;
-- PLACEHOLDER prices: edit to your real prices.
insert into byo.prices (plan_code, country, currency, amount_minor, label) values
    ('m1','KE','KES', 50000, null), ('m3','KE','KES',135000,'Save 10%'), ('m12','KE','KES',480000,'Best value'),
    ('m1','*','USD',   499, null), ('m3','*','USD',  1299,'Save 13%'), ('m12','*','USD',  4499,'Best value')
on conflict (plan_code, country) do nothing;

-- ---------- payment intents (M-Pesa STK push, card checkout) ----------
create table if not exists byo.payment_intents (
    id            uuid primary key default gen_random_uuid(),
    device_id     text not null references byo.devices(device_id) on delete cascade,
    plan_code     text not null references byo.plans(code),
    method        text not null check (method in ('mpesa','card')),
    country       text,
    currency      text not null,
    amount_minor  integer not null check (amount_minor > 0),
    phone         text,                -- M-Pesa MSISDN (2547XXXXXXXX)
    provider      text,                -- 'daraja', 'flutterwave', 'paystack', 'stripe', ...
    provider_ref  text unique,         -- CheckoutRequestID / tx_ref / session id
    checkout_url  text,
    status        text not null default 'created'
                   check (status in ('created','pending','paid','failed','cancelled','expired')),
    raw           jsonb,
    created_at    timestamptz not null default now(),
    paid_at       timestamptz,
    updated_at    timestamptz not null default now()
);
create index if not exists payment_intents_device_idx on byo.payment_intents(device_id, created_at desc);
alter table byo.payment_intents enable row level security;

-- ---------- helpers ----------
create or replace function byo.trial_days() returns integer language sql stable as $$
    select coalesce((select (value)::text::integer from byo.app_config where key='trial_days'), 3);
$$;

-- Register / touch a device and start its trial once. Returns the billing state.
create or replace function byo.device_start(p_device_id text, p_country text, p_platform text, p_trial_started timestamptz default null)
returns table(state text, trial_ends_at timestamptz, sub_expires_at timestamptz)
language plpgsql security definer set search_path = byo as $$
begin
    insert into byo.devices(device_id, country, platform, trial_started_at, last_seen)
    values (p_device_id, nullif(p_country,''), p_platform, coalesce(least(p_trial_started, now()), now()), now())
    on conflict (device_id) do update
        set country = coalesce(nullif(excluded.country,''), byo.devices.country),
            platform = coalesce(excluded.platform, byo.devices.platform),
            -- the trial starts once; a reinstall can never move it later
            trial_started_at = coalesce(byo.devices.trial_started_at, excluded.trial_started_at),
            last_seen = now();
    return query select * from byo.billing_status(p_device_id);
end; $$;

-- state: 'active' (paid), 'trial' (inside the free days), 'expired' (show the payment wall)
create or replace function byo.billing_status(p_device_id text)
returns table(state text, trial_ends_at timestamptz, sub_expires_at timestamptz)
language plpgsql security definer set search_path = byo as $$
declare v_trial_end timestamptz; v_sub timestamptz;
begin
    select d.trial_started_at + (byo.trial_days() || ' days')::interval into v_trial_end from byo.devices d where d.device_id = p_device_id;
    select s.expires_at into v_sub from byo.subscriptions s where s.device_id = p_device_id and s.status = 'active';
    return query select
        case when v_sub is not null and v_sub > now() then 'active'
             when v_trial_end is not null and v_trial_end > now() then 'trial'
             else 'expired' end,
        v_trial_end, v_sub;
end; $$;

-- Extend (or start) a device's subscription by a plan's duration. Used by payment-webhook.
create or replace function byo.grant_subscription(p_device_id text, p_plan_code text)
returns timestamptz language plpgsql security definer set search_path = byo as $$
declare v_plan byo.plans%rowtype; v_exp timestamptz;
begin
    select * into v_plan from byo.plans where code = p_plan_code;
    if not found then raise exception 'plan % not found', p_plan_code; end if;
    insert into byo.subscriptions(device_id, plan_id, status, activated_at, expires_at)
    values (p_device_id, v_plan.id, 'active', now(), now() + (v_plan.duration_days || ' days')::interval)
    on conflict (device_id) do update
        set plan_id = excluded.plan_id, status = 'active', activated_at = now(),
            expires_at = greatest(byo.subscriptions.expires_at, now()) + (v_plan.duration_days || ' days')::interval,
            updated_at = now()
    returning expires_at into v_exp;
    return v_exp;
end; $$;

-- Mark an intent paid exactly once and grant the subscription.
create or replace function byo.complete_intent(p_provider_ref text, p_raw jsonb)
returns text language plpgsql security definer set search_path = byo as $$
declare v_pi byo.payment_intents%rowtype;
begin
    select * into v_pi from byo.payment_intents where provider_ref = p_provider_ref for update;
    if not found then return 'unknown'; end if;
    if v_pi.status = 'paid' then return 'duplicate'; end if;
    update byo.payment_intents set status='paid', paid_at=now(), raw=coalesce(p_raw, raw), updated_at=now() where id = v_pi.id;
    perform byo.grant_subscription(v_pi.device_id, v_pi.plan_code);
    return 'paid';
end; $$;
