-- ============================================================================
-- Salesperson referral links + one-tap customer activation.
--
--  1. A salesperson creates their own referral code ONCE (then it is locked for good).
--       public.byo_sales_code_check(token, code)   live "is it free?" check
--       public.byo_sales_set_code(token, code)     create once; unique in the database
--  2. Admin connection pool (usernames / passwords / server or playlist links):
--       byo.conn_pool                              Available | Assigned | Disabled
--       console actions fleet.pool_list / pool_add / pool_set / pool_delete / alerts_ack
--  3. The salesperson's "Activate" button:
--       public.byo_sales_activate(token, referral_id)
--       claims ONE available connection with a row lock (never handed out twice), binds it to the
--       customer's device, starts the free trial, records who activated and when. Empty pool: the
--       salesperson gets a clear message and the admin gets an alert (byo.admin_alerts).
--  4. The customer's app picks the connection up by itself at its next check-in:
--       public.byo_provision_fetch(device_key) / byo_provision_ack(device_key, ok, err)
--  5. public.byo_sales_dash(token): current-month sales and new users, trial countdowns,
--     every payment per referred customer. A salesperson only ever sees their own customers.
--
-- Builds on 0018. Existing functions are wrapped, not replaced (byo_support_admin, byo_device_checkin,
-- byo_device_flags), so nothing from earlier migrations is lost. Safe to run more than once.
-- Run once in the Supabase SQL Editor for BYO Tv.
-- ============================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- referral codes: create once, unique
alter table byo.sales_agents alter column code drop not null;
alter table byo.sales_agents add column if not exists code_set boolean;
update byo.sales_agents set code_set = (code is not null) where code_set is null;
alter table byo.sales_agents alter column code_set set default false;
alter table byo.sales_agents alter column code_set set not null;
create unique index if not exists sales_agents_code on byo.sales_agents (upper(code));   -- same index as 0018: no two people share a code
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'sales_agents_code_format') then
        alter table byo.sales_agents add constraint sales_agents_code_format check (code is null or code ~ '^[A-Z0-9][A-Z0-9-]{2,18}[A-Z0-9]$');
    end if;
end $$;

-- a code given by the admin at creation counts as already chosen; a locked code can never change or be cleared
create or replace function byo._sales_code_guard() returns trigger language plpgsql as $$
begin
    if tg_op = 'INSERT' then
        if new.code is not null then new.code_set := true; new.code := upper(new.code); end if;
        return new;
    end if;
    if old.code_set and (new.code is distinct from old.code or not new.code_set) then
        raise exception 'This referral code is locked and cannot be changed.' using errcode = '23514';
    end if;
    return new;
end $$;
drop trigger if exists sales_code_guard on byo.sales_agents;
create trigger sales_code_guard before insert or update on byo.sales_agents for each row execute function byo._sales_code_guard();

alter table byo.referrals add column if not exists id uuid default gen_random_uuid();
update byo.referrals set id = gen_random_uuid() where id is null;
create unique index if not exists referrals_id on byo.referrals (id);

-- ---------------------------------------------------------------- admin connection pool
create table if not exists byo.app_config (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table byo.app_config enable row level security;
insert into byo.app_config(key, value) values ('activation_trial_days', '7'::jsonb) on conflict (key) do nothing;

create table if not exists byo.conn_pool (
    id uuid primary key default gen_random_uuid(),
    mode text not null check (mode in ('xtream','m3u')),
    name text not null default '',
    server text, url text, username text, password text, epg text,
    status text not null default 'available' check (status in ('available','assigned','disabled')),
    assigned_device_key text, assigned_agent_id uuid references byo.sales_agents(id) on delete set null, assigned_at timestamptz,
    created_at timestamptz not null default now(), created_by text,
    constraint conn_pool_fields check ((mode = 'xtream' and coalesce(server,'') <> '' and coalesce(username,'') <> '' and coalesce(password,'') <> '') or (mode = 'm3u' and coalesce(url,'') <> ''))
);
create unique index if not exists conn_pool_unique on byo.conn_pool (mode, lower(coalesce(server, url)), coalesce(username, ''));
create index if not exists conn_pool_status on byo.conn_pool (status, created_at);
alter table byo.conn_pool enable row level security;      -- no policies: only the functions below can touch it

create table if not exists byo.provisions (
    device_key text primary key,
    referral_id uuid, agent_id uuid references byo.sales_agents(id) on delete set null,
    pool_id uuid references byo.conn_pool(id) on delete set null,
    trial_days int not null default 7,
    activated_at timestamptz not null default now(),
    fetched_at timestamptz, acked_at timestamptz, attempts int not null default 0, last_error text
);
alter table byo.provisions enable row level security;

create table if not exists byo.admin_alerts (
    id uuid primary key default gen_random_uuid(),
    kind text not null, message text not null,
    created_at timestamptz not null default now(), resolved_at timestamptz
);
create unique index if not exists admin_alerts_open on byo.admin_alerts (kind) where resolved_at is null;
alter table byo.admin_alerts enable row level security;

-- ---------------------------------------------------------------- helpers
create or replace function byo._agent(p_token text) returns byo.sales_agents
language sql stable security definer set search_path = byo, public, extensions as $$
    select g.* from byo.sales_agents g join byo.sales_sessions s on s.agent_id = g.id
     where s.token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex') and s.expires_at > now() and g.active limit 1;
$$;
revoke all on function byo._agent(text) from public, anon, authenticated;

create or replace function byo._norm_code(p text) returns text language sql immutable as $$
    select regexp_replace(upper(btrim(coalesce(p,''))), '[^A-Z0-9-]', '', 'g');
$$;

-- ---------------------------------------------------------------- 1. create the referral code once
create or replace function public.byo_sales_code_check(p_token text, p_code text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents; v text := byo._norm_code(p_code);
begin
    a := byo._agent(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;
    if a.code_set then return jsonb_build_object('ok', false, 'locked', true, 'code', a.code, 'error', 'Your code is already set.'); end if;
    if v !~ '^[A-Z0-9][A-Z0-9-]{2,18}[A-Z0-9]$' then
        return jsonb_build_object('ok', true, 'code', v, 'available', false, 'error', 'Use 4 to 20 letters or numbers (a hyphen is fine in the middle).');
    end if;
    if exists (select 1 from byo.sales_agents where upper(code) = v and id <> a.id) then
        return jsonb_build_object('ok', true, 'code', v, 'available', false, 'error', 'That code is already taken. Try another.');
    end if;
    return jsonb_build_object('ok', true, 'code', v, 'available', true);
end $$;
revoke all on function public.byo_sales_code_check(text,text) from public;
grant execute on function public.byo_sales_code_check(text,text) to anon, authenticated;

create or replace function public.byo_sales_set_code(p_token text, p_code text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents; v text := byo._norm_code(p_code);
begin
    a := byo._agent(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;
    select * into a from byo.sales_agents where id = a.id for update;          -- two taps at once cannot both win
    if a.code_set then return jsonb_build_object('ok', false, 'locked', true, 'code', a.code, 'error', 'Your code is already set and cannot be changed.'); end if;
    if v !~ '^[A-Z0-9][A-Z0-9-]{2,18}[A-Z0-9]$' then return jsonb_build_object('ok', false, 'error', 'Use 4 to 20 letters or numbers (a hyphen is fine in the middle).'); end if;
    begin
        update byo.sales_agents set code = v, code_set = true where id = a.id and not code_set;
    exception when unique_violation then
        return jsonb_build_object('ok', false, 'error', 'That code is already taken. Try another.');
    end;
    return jsonb_build_object('ok', true, 'code', v);
end $$;
revoke all on function public.byo_sales_set_code(text,text) from public;
grant execute on function public.byo_sales_set_code(text,text) to anon, authenticated;

-- ---------------------------------------------------------------- 5. the salesperson's dashboard
create or replace function public.byo_sales_dash(p_token text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents;
        v_m0 timestamptz := date_trunc('month', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi';
        v_rows jsonb; v_msales jsonb; v_asales jsonb; v_new_m int; v_new_all int;
begin
    a := byo._agent(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;

    select coalesce(jsonb_agg(x order by (x->>'referred_at') desc), '[]'::jsonb) into v_rows from (
        select jsonb_build_object(
            'rid', r.id, 'tv_id', upper(right(r.device_key, 6)), 'referred_at', r.referred_at, 'last_seen', t.last_seen,
            'platform', t.state->>'platform', 'country', t.state->>'country',
            'activated', pv.device_key is not null, 'activated_at', pv.activated_at, 'delivered', pv.acked_at is not null,
            'status', case when s.st = 'blocked' then 'expired'
                           when s.st = 'active' and s.u > now() then
                                case when pa.any_paid or s.paid then 'paid' when s.u <= now() + interval '48 hours' then 'expiring' else 'trial' end
                           when s.u is not null then 'expired' else 'pending' end,
            'ends_at', s.u,
            'seconds_left', case when s.st = 'active' and s.u > now() then floor(extract(epoch from (s.u - now()))) end,
            'active_days', (select count(*) from byo.device_activity d where d.device_key = r.device_key),
            'paid', (select coalesce(jsonb_object_agg(cur, amt), '{}'::jsonb) from (select coalesce(p.currency,'?') cur, sum(p.amount) amt from byo.pay_received p where p.device_key = r.device_key and p.status in ('matched','held') group by 1) q),
            'payments', (select coalesce(jsonb_agg(jsonb_build_object('at', coalesce(p.paid_at, p.received_at), 'amount', p.amount, 'currency', p.currency, 'method', p.method, 'ref', p.txn_id,
                                  'plan', q2.plan_name, 'days', q2.days, 'until', q2.granted_until,
                                  'from', case when q2.granted_until is not null and q2.days is not null then q2.granted_until - make_interval(days => q2.days) end)
                                  order by coalesce(p.paid_at, p.received_at) desc), '[]'::jsonb)
                           from byo.pay_received p left join byo.pay_requests q2 on q2.id = p.request_id
                          where p.device_key = r.device_key and p.status in ('matched','held'))
        ) x
        from byo.referrals r
        left join byo.tv_devices t on t.device_key = r.device_key
        left join byo.provisions pv on pv.device_key = r.device_key
        left join lateral (select flags->'access' acc from byo.device_flags where device_key = r.device_key) f on true
        cross join lateral (select (f.acc->>'until')::timestamptz u, f.acc->>'state' st, coalesce((f.acc->>'paid')::boolean, false) paid) s
        cross join lateral (select exists(select 1 from byo.pay_received p where p.device_key = r.device_key and p.status in ('matched','held')) any_paid) pa
        where r.agent_id = a.id) z;

    select coalesce(jsonb_object_agg(cur, amt), '{}'::jsonb) into v_msales from (
        select coalesce(p.currency,'?') cur, sum(p.amount) amt from byo.pay_received p join byo.referrals r on r.device_key = p.device_key
         where r.agent_id = a.id and p.status in ('matched','held') and coalesce(p.paid_at, p.received_at) >= v_m0 group by 1) q;
    select coalesce(jsonb_object_agg(cur, amt), '{}'::jsonb) into v_asales from (
        select coalesce(p.currency,'?') cur, sum(p.amount) amt from byo.pay_received p join byo.referrals r on r.device_key = p.device_key
         where r.agent_id = a.id and p.status in ('matched','held') group by 1) q;
    select count(*) filter (where referred_at >= v_m0), count(*) into v_new_m, v_new_all from byo.referrals where agent_id = a.id;

    return jsonb_build_object('ok', true,
        'agent', jsonb_build_object('name', a.name, 'email', a.email, 'code', a.code, 'code_set', a.code_set, 'pct', a.pct),
        'month', jsonb_build_object('label', to_char(now() at time zone 'Africa/Nairobi', 'FMMonth YYYY'), 'sales', v_msales, 'new_users', v_new_m),
        'all_time', jsonb_build_object('sales', v_asales, 'users', v_new_all),
        'customers', v_rows, 'now', now());
end $$;
revoke all on function public.byo_sales_dash(text) from public;
grant execute on function public.byo_sales_dash(text) to anon, authenticated;

-- ---------------------------------------------------------------- 3. Activate
create or replace function public.byo_sales_activate(p_token text, p_rid uuid)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare a byo.sales_agents; r byo.referrals; c byo.conn_pool; v_days int; v_until timestamptz; v_cur jsonb; v_left int;
begin
    a := byo._agent(p_token);
    if a.id is null then return jsonb_build_object('ok', false, 'auth', true, 'error', 'Please sign in again.'); end if;
    select * into r from byo.referrals where id = p_rid and agent_id = a.id for update;     -- only your own customers
    if not found then return jsonb_build_object('ok', false, 'error', 'That customer was not found.'); end if;
    if exists (select 1 from byo.provisions where device_key = r.device_key) then return jsonb_build_object('ok', true, 'already', true); end if;
    select flags->'access' into v_cur from byo.device_flags where device_key = r.device_key;
    if v_cur is not null and v_cur->>'state' = 'blocked' then return jsonb_build_object('ok', false, 'error', 'This device was switched off by BYO support. Contact support.'); end if;

    select * into c from byo.conn_pool where status = 'available' order by created_at, id limit 1 for update skip locked;
    if not found then
        insert into byo.admin_alerts(kind, message) values ('pool_empty', 'The connection pool is empty. A salesperson tried to activate a customer. Add more connections.') on conflict do nothing;
        return jsonb_build_object('ok', false, 'pool_empty', true, 'error', 'No connections are available right now. The admin has been notified. Please try again later.');
    end if;

    v_days := coalesce((select (value)::text::int from byo.app_config where key = 'activation_trial_days'), 7);
    update byo.conn_pool set status = 'assigned', assigned_device_key = r.device_key, assigned_agent_id = a.id, assigned_at = now() where id = c.id;
    insert into byo.provisions(device_key, referral_id, agent_id, pool_id, trial_days) values (r.device_key, r.id, a.id, c.id, v_days);

    -- the trial starts now (never shortens time the device already has)
    v_until := now() + make_interval(days => v_days);
    if v_cur is not null and v_cur->>'state' = 'active' and (v_cur->>'until')::timestamptz > v_until then v_until := (v_cur->>'until')::timestamptz; end if;
    insert into byo.device_flags(device_key, flags, updated_at)
    values (r.device_key, jsonb_build_object('access', jsonb_build_object('state','active','until', v_until,'at', now(),'by','sales:'||a.name,'paid', coalesce((v_cur->>'paid')::boolean,false),'plan','trial','ref','activation')), now())
    on conflict (device_key) do update set flags = byo.device_flags.flags || jsonb_build_object('access', jsonb_build_object('state','active','until', v_until,'at', now(),'by','sales:'||a.name,'paid', coalesce((v_cur->>'paid')::boolean,false),'plan','trial','ref','activation')), updated_at = now();

    select count(*) into v_left from byo.conn_pool where status = 'available';
    if v_left = 0 then insert into byo.admin_alerts(kind, message) values ('pool_empty', 'The connection pool is now empty. Add more connections.') on conflict do nothing;
    elsif v_left <= 3 then insert into byo.admin_alerts(kind, message) values ('pool_low', 'Only a few connections are left in the pool. Add more soon.') on conflict do nothing; end if;
    return jsonb_build_object('ok', true, 'trial_days', v_days, 'ends_at', v_until);
end $$;
revoke all on function public.byo_sales_activate(text,uuid) from public;
grant execute on function public.byo_sales_activate(text,uuid) to anon, authenticated;

-- ---------------------------------------------------------------- 4. the app collects its connection
-- Handed over only to the device it was assigned to, only until the app confirms it, and only for 3 days.
create or replace function public.byo_provision_fetch(p_device_key text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare pv byo.provisions; c byo.conn_pool;
begin
    select * into pv from byo.provisions where device_key = p_device_key and acked_at is null and attempts < 10 and activated_at > now() - interval '3 days';
    if not found then return jsonb_build_object('ok', true, 'none', true); end if;
    select * into c from byo.conn_pool where id = pv.pool_id and assigned_device_key = p_device_key;
    if not found then return jsonb_build_object('ok', true, 'none', true); end if;
    update byo.provisions set fetched_at = now(), attempts = attempts + 1 where device_key = p_device_key;
    return jsonb_build_object('ok', true, 'conn', jsonb_build_object('mode', c.mode, 'name', coalesce(nullif(c.name,''), 'BYO Player'), 'server', coalesce(c.server,''), 'url', coalesce(c.url,''),
                              'user', coalesce(c.username,''), 'pass', coalesce(c.password,''), 'epg', coalesce(c.epg,'')));
end $$;
revoke all on function public.byo_provision_fetch(text) from public;
grant execute on function public.byo_provision_fetch(text) to anon, authenticated;

create or replace function public.byo_provision_ack(p_device_key text, p_ok boolean, p_err text default null)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
begin
    if p_ok then update byo.provisions set acked_at = now(), last_error = null where device_key = p_device_key and acked_at is null;
    else update byo.provisions set last_error = left(coalesce(p_err,''), 200) where device_key = p_device_key and acked_at is null; end if;
    return jsonb_build_object('ok', true);
end $$;
revoke all on function public.byo_provision_ack(text,boolean,text) from public;
grant execute on function public.byo_provision_ack(text,boolean,text) to anon, authenticated;

-- check-in and the quick flag poll now also say "a connection is waiting for you"
do $$ begin
    if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'byo_device_checkin' and position('prov-wrapper' in prosrc) = 0) then
        drop function if exists byo._device_checkin_base(text, jsonb);
        alter function public.byo_device_checkin(text, jsonb) rename to _device_checkin_base;
        alter function public._device_checkin_base(text, jsonb) set schema byo;
    end if;
    if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'byo_device_flags' and position('prov-wrapper' in prosrc) = 0) then
        drop function if exists byo._device_flags_base(text);
        alter function public.byo_device_flags(text) rename to _device_flags_base;
        alter function public._device_flags_base(text) set schema byo;
    end if;
end $$;
revoke all on function byo._device_checkin_base(text, jsonb) from public, anon, authenticated;
revoke all on function byo._device_flags_base(text) from public, anon, authenticated;

create or replace function public.byo_device_checkin(p_device_key text, p_state jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare r jsonb;
begin   -- prov-wrapper
    r := coalesce(byo._device_checkin_base(p_device_key, p_state), '{}'::jsonb);
    return r || jsonb_build_object('provision', exists(select 1 from byo.provisions where device_key = p_device_key and acked_at is null and attempts < 10 and activated_at > now() - interval '3 days'));
end $$;
revoke all on function public.byo_device_checkin(text,jsonb) from public;
grant execute on function public.byo_device_checkin(text,jsonb) to anon, authenticated;

create or replace function public.byo_device_flags(p_device_key text)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
declare r jsonb;
begin   -- prov-wrapper
    r := coalesce(byo._device_flags_base(p_device_key), '{}'::jsonb);
    return r || jsonb_build_object('provision', exists(select 1 from byo.provisions where device_key = p_device_key and acked_at is null and attempts < 10 and activated_at > now() - interval '3 days'));
end $$;
revoke all on function public.byo_device_flags(text) from public;
grant execute on function public.byo_device_flags(text) to anon, authenticated;

-- (the console action chain lives in 0022_admin_chain.sql: pool actions are handled there)

notify pgrst, 'reload schema';
