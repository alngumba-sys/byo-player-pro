-- ============================================================================
-- BYO Player Pro telebirr backend — RPC functions (the "referee").
-- All are SECURITY DEFINER and called from the API with the service role.
-- They encode every safety rule so the client (TV, phone) can never bypass them.
-- ============================================================================

-- Tunables -------------------------------------------------------------------
--   PENDING_TTL_MIN   : minutes an UNPAID pending stays reservable (partial never expires)
--   MATCH_WINDOW_MIN  : how far back a payment may match a pending (slack for clock skew)
-- Kept as SQL constants inline; change here and re-run.

-- ---------------------------------------------------------------------------
-- expire_stale_pendings() — housekeeping. Marks UNPAID (paid_amount = 0) pendings
-- older than 10 min as 'expired', freeing their amount back to the allocator pool.
-- PARTIALLY paid pendings are deliberately left open forever (top-up allowed).
-- Call opportunistically at the start of allocate/match, and/or on a cron.
-- ---------------------------------------------------------------------------
create or replace function byo.expire_stale_pendings()
returns void language sql security definer set search_path = byo as $$
    update byo.pending_activations
       set status = 'expired'
     where status = 'awaiting'
       and paid_amount = 0
       and expires_at < now();
$$;

-- ---------------------------------------------------------------------------
-- start_activation(device, plan, last4, phone) -> the exact whole-birr amount.
--
-- Allocates a UNIQUE (required_amount, last4) among currently-open pendings:
-- starts at the plan price and bumps by whole birr until the (amount,last4) pair
-- is free. Enforces one open pending per device (reuses/replaces the old one if
-- the same device asks again before paying).
--
-- Returns a single row: pending id, amount to pay, expiry, plan details.
-- ---------------------------------------------------------------------------
create or replace function byo.start_activation(
    p_device_id text,
    p_plan_code text,
    p_last4     text,
    p_phone     text default null
)
returns table (
    pending_id      uuid,
    required_amount integer,
    expires_at      timestamptz,
    plan_name       text,
    plan_price      integer
)
language plpgsql security definer set search_path = byo as $$
declare
    v_plan      byo.plans%rowtype;
    v_amount    integer;
    v_pending   uuid;
    v_expires   timestamptz := now() + interval '10 minutes';
begin
    if p_last4 !~ '^[0-9]{4}$' then
        raise exception 'last4 must be exactly 4 digits';
    end if;

    select * into v_plan from byo.plans where code = p_plan_code and active = true;
    if not found then
        raise exception 'plan % not found or inactive', p_plan_code;
    end if;

    -- make sure the device exists
    insert into byo.devices(device_id, country)
        values (p_device_id, 'ET')
    on conflict (device_id) do update set last_seen = now();

    perform byo.expire_stale_pendings();

    -- If this device already has an OPEN pending, retire it first (unless it is
    -- partially paid — then we must not throw that money away; return it as-is).
    perform 1 from byo.pending_activations
        where device_id = p_device_id and status = 'partial' limit 1;
    if found then
        return query
            select pa.id, pa.required_amount, pa.expires_at, v_plan.name, v_plan.price_etb
              from byo.pending_activations pa
             where pa.device_id = p_device_id and pa.status = 'partial'
             limit 1;
        return;
    end if;

    update byo.pending_activations
       set status = 'expired'
     where device_id = p_device_id and status = 'awaiting';

    -- Allocate a unique whole-birr amount for this last4 among OPEN pendings.
    v_amount := v_plan.price_etb;
    while exists (
        select 1 from byo.pending_activations pa
         where pa.payer_last4 = p_last4
           and pa.required_amount = v_amount
           and pa.status in ('awaiting','partial')
    ) loop
        v_amount := v_amount + 1;
        if v_amount > v_plan.price_etb + 100 then
            raise exception 'no free amount slot for last4 % (pool exhausted)', p_last4;
        end if;
    end loop;

    insert into byo.pending_activations(
        device_id, plan_id, payer_last4, payer_phone,
        required_amount, paid_amount, status, expires_at)
    values (p_device_id, v_plan.id, p_last4, p_phone,
        v_amount, 0, 'awaiting', v_expires)
    returning id into v_pending;

    return query select v_pending, v_amount, v_expires, v_plan.name, v_plan.price_etb;
end; $$;

-- ---------------------------------------------------------------------------
-- activation_status(device) -> what the TV should display right now.
-- Shows awaiting / partial (with balance due) / active / expired.
-- ---------------------------------------------------------------------------
create or replace function byo.activation_status(p_device_id text)
returns table (
    state          text,       -- 'awaiting' | 'partial' | 'active' | 'expired' | 'none'
    required_amount integer,
    paid_amount    integer,
    balance_due    integer,
    expires_at     timestamptz,
    sub_expires_at timestamptz
)
language plpgsql security definer set search_path = byo as $$
declare
    v_sub byo.subscriptions%rowtype;
    v_pa  byo.pending_activations%rowtype;
begin
    perform byo.expire_stale_pendings();

    select * into v_sub from byo.subscriptions
        where device_id = p_device_id;

    -- Active subscription wins.
    if found and v_sub.status = 'active' and v_sub.expires_at > now() then
        return query select 'active', null::int, null::int, null::int,
                            null::timestamptz, v_sub.expires_at;
        return;
    end if;

    select * into v_pa from byo.pending_activations
        where device_id = p_device_id and status in ('awaiting','partial')
        order by created_at desc limit 1;

    if found then
        return query select v_pa.status, v_pa.required_amount, v_pa.paid_amount,
                            greatest(v_pa.required_amount - v_pa.paid_amount, 0),
                            v_pa.expires_at, null::timestamptz;
        return;
    end if;

    -- nothing open; was there a recent expiry?
    select * into v_pa from byo.pending_activations
        where device_id = p_device_id and status = 'expired'
        order by updated_at desc limit 1;
    if found then
        return query select 'expired', v_pa.required_amount, v_pa.paid_amount,
                            null::int, v_pa.expires_at, null::timestamptz;
        return;
    end if;

    return query select 'none', null::int, null::int, null::int,
                        null::timestamptz, null::timestamptz;
end; $$;

-- ---------------------------------------------------------------------------
-- activate_subscription(pending) — internal: flip the device subscription on.
-- ---------------------------------------------------------------------------
create or replace function byo.activate_subscription(p_pending uuid)
returns void language plpgsql security definer set search_path = byo as $$
declare
    v_pa   byo.pending_activations%rowtype;
    v_days integer;
begin
    select * into v_pa from byo.pending_activations where id = p_pending;
    if not found then raise exception 'pending % not found', p_pending; end if;

    select duration_days into v_days from byo.plans where id = v_pa.plan_id;

    insert into byo.subscriptions(device_id, plan_id, status, activated_at, expires_at)
    values (v_pa.device_id, v_pa.plan_id, 'active', now(), now() + (v_days || ' days')::interval)
    on conflict (device_id) do update
        set plan_id = excluded.plan_id,
            status = 'active',
            activated_at = now(),
            -- stack time if they renew before expiry, else start fresh
            expires_at = greatest(byo.subscriptions.expires_at, now()) + (v_days || ' days')::interval;

    update byo.pending_activations
        set status = 'matched', matched_at = now()
      where id = p_pending;
end; $$;

-- ---------------------------------------------------------------------------
-- ingest_payment(...) — THE MATCHER. Called by the API for each telebirr SMS.
-- Returns the outcome so the collector/admin can see what happened.
--
-- Algorithm:
--   1. txn_id already seen  -> 'duplicate' (anti-replay; do nothing).
--   2. Record the payment row (raw SMS kept regardless of outcome).
--   3. Find OPEN pendings for this last4:
--        0 pendings            -> 'review' (unexpected money)
--        >1 pendings           -> if amount EXACTLY equals one record's required
--                                 (full, unambiguous) apply to it; else 'review'
--                                 (collision + partial is unattributable by rule)
--        exactly 1 pending     -> apply amount to it:
--             paid_amount += amount
--             if paid_amount >= required -> activate (exact/again-exact total)
--             elif paid_amount  < required -> status 'partial' (balance shown on TV)
--   NB: "exact total required" — we activate only when the cumulative total
--       REACHES required. Overpay (paid>required) still activates (never penalise)
--       but is flagged for optional manual refund via the admin view.
-- ---------------------------------------------------------------------------
create or replace function byo.ingest_payment(
    p_txn_id    text,
    p_amount    integer,          -- whole birr (floor of received)
    p_amount_raw numeric,
    p_last4     text,
    p_payer_name text,
    p_paid_at   timestamptz,
    p_balance   numeric,
    p_raw_text  text
)
returns table (outcome text, detail text, pending_id uuid)
language plpgsql security definer set search_path = byo as $$
declare
    v_payment   uuid;
    v_pa        byo.pending_activations%rowtype;
    v_open_cnt  integer;
    v_exact     byo.pending_activations%rowtype;
    v_new_paid  integer;
begin
    -- 1) anti-replay
    if exists (select 1 from byo.payments where txn_id = p_txn_id) then
        return query select 'duplicate'::text, 'txn already ingested'::text, null::uuid;
        return;
    end if;

    perform byo.expire_stale_pendings();

    -- 2) record payment (always, even if unresolved — keep raw for re-parse/audit)
    insert into byo.payments(txn_id, amount, amount_raw, payer_name, payer_last4,
                             paid_at, balance_after, raw_text, outcome)
    values (p_txn_id, p_amount, p_amount_raw, p_payer_name, p_last4,
            p_paid_at, p_balance, p_raw_text, 'unresolved')
    returning id into v_payment;

    if p_last4 is null or p_last4 !~ '^[0-9]{4}$' then
        update byo.payments set outcome='review' where id=v_payment;
        return query select 'review'::text, 'no usable last4 in SMS'::text, null::uuid;
        return;
    end if;

    -- 3) how many OPEN pendings share this last4?
    select count(*) into v_open_cnt
      from byo.pending_activations
     where payer_last4 = p_last4 and status in ('awaiting','partial');

    if v_open_cnt = 0 then
        update byo.payments set outcome='review' where id=v_payment;
        return query select 'review'::text, 'no pending activation for last4'::text, null::uuid;
        return;

    elsif v_open_cnt = 1 then
        select * into v_pa from byo.pending_activations
         where payer_last4 = p_last4 and status in ('awaiting','partial')
         limit 1;

    else
        -- collision: only accept if this amount EXACTLY equals one record's
        -- required amount AND that record is still fully unpaid (clean full pay).
        select * into v_exact from byo.pending_activations
         where payer_last4 = p_last4
           and status = 'awaiting'
           and paid_amount = 0
           and required_amount = p_amount
         limit 1;
        if found then
            v_pa := v_exact;
        else
            update byo.payments set outcome='review' where id=v_payment;
            return query select 'review'::text,
                         'last4 collision — amount not an unambiguous full match'::text,
                         null::uuid;
            return;
        end if;
    end if;

    -- apply the payment to the chosen pending
    v_new_paid := v_pa.paid_amount + p_amount;
    update byo.pending_activations
       set paid_amount = v_new_paid,
           status = case when v_new_paid >= v_pa.required_amount then 'matched' else 'partial' end
     where id = v_pa.id;
    update byo.payments set outcome='applied', pending_id = v_pa.id where id = v_payment;

    if v_new_paid >= v_pa.required_amount then
        perform byo.activate_subscription(v_pa.id);
        if v_new_paid > v_pa.required_amount then
            return query select 'activated_overpaid'::text,
                   format('paid %s of %s — overpaid by %s',
                          v_new_paid, v_pa.required_amount, v_new_paid - v_pa.required_amount),
                   v_pa.id;
        else
            return query select 'activated'::text,
                   format('paid %s of %s', v_new_paid, v_pa.required_amount), v_pa.id;
        end if;
    else
        return query select 'partial'::text,
               format('paid %s of %s — balance %s',
                      v_new_paid, v_pa.required_amount, v_pa.required_amount - v_new_paid),
               v_pa.id;
    end if;
end; $$;

-- ---------------------------------------------------------------------------
-- Admin helpers (called from the dashboard with service role).
-- ---------------------------------------------------------------------------
-- List payments needing a human (collision/partial/unexpected).
create or replace function byo.review_queue()
returns setof byo.payments
language sql security definer set search_path = byo as $$
    select * from byo.payments where outcome = 'review' order by received_at desc;
$$;

-- Manually attach a reviewed payment to a pending and (optionally) activate.
create or replace function byo.admin_apply_payment(p_payment uuid, p_pending uuid)
returns void language plpgsql security definer set search_path = byo as $$
declare v_amount integer; v_pa byo.pending_activations%rowtype; v_new integer;
begin
    select amount into v_amount from byo.payments where id = p_payment;
    select * into v_pa from byo.pending_activations where id = p_pending;
    v_new := v_pa.paid_amount + v_amount;
    update byo.pending_activations
       set paid_amount = v_new,
           status = case when v_new >= v_pa.required_amount then 'matched' else 'partial' end
     where id = p_pending;
    update byo.payments set outcome='applied', pending_id = p_pending where id = p_payment;
    if v_new >= v_pa.required_amount then perform byo.activate_subscription(p_pending); end if;
end; $$;
