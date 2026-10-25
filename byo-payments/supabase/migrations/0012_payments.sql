-- ============================================================================
-- BYO Player Pro: pay by sending money to a phone number (M-Pesa in Kenya, telebirr
-- in Ethiopia), confirmed by the BYO Collector phone that reads the payment SMS.
--
--   1. The TV shows the plans for its country (set in the support console).
--   2. The customer picks a plan and types the phone number they will pay FROM.
--      byo_pay_start() records a pending request and returns the number to pay TO.
--   3. The customer sends the money. The collector phone gets "You have received ..."
--      and calls byo_collector_ingest() with the details it read.
--   4. The matcher finds the pending request with the same payer number (the first and
--      last digits the SMS shows, e.g. 0114***089) and an amount at least the plan price,
--      then turns the TV on until now + plan days (added on top of any time left).
--   5. The TV, polling byo_pay_status(), unlocks within seconds.
--
-- Console actions (through the admin function, no redeploy needed):
--   fleet.pay_config, fleet.pay_config_set, fleet.pay_key_new, fleet.payments
--
-- Needs 0006 to 0010. Safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------- tables
create table if not exists byo.pay_config (
    id                  int primary key default 1 check (id = 1),
    cfg                 jsonb not null,
    collector_key_hash  text,
    updated_at          timestamptz not null default now(),
    updated_by          text
);
insert into byo.pay_config(id, cfg) values (1, jsonb_build_object(
    'KE', jsonb_build_object('method','mpesa','currency','KES','number','','name','','plans', jsonb_build_array(
        jsonb_build_object('code','day','name','Daily','days',1,'amount',5,'on',true),
        jsonb_build_object('code','week','name','Weekly','days',7,'amount',10,'on',true),
        jsonb_build_object('code','month','name','Monthly','days',30,'amount',15,'on',true),
        jsonb_build_object('code','quarter','name','Quarterly','days',90,'amount',45,'on',false))),
    'ET', jsonb_build_object('method','telebirr','currency','ETB','number','','name','','plans', jsonb_build_array(
        jsonb_build_object('code','day','name','Daily','days',1,'amount',5,'on',true),
        jsonb_build_object('code','week','name','Weekly','days',7,'amount',10,'on',true),
        jsonb_build_object('code','month','name','Monthly','days',30,'amount',15,'on',true),
        jsonb_build_object('code','quarter','name','Quarterly','days',90,'amount',45,'on',false)))
)) on conflict (id) do nothing;
alter table byo.pay_config enable row level security;

create table if not exists byo.pay_requests (
    id            uuid primary key default gen_random_uuid(),
    device_key    text not null,
    country       text not null,
    method        text not null,            -- mpesa | telebirr
    currency      text not null,
    plan_code     text not null,
    plan_name     text not null,
    days          int  not null,
    amount        numeric(12,2) not null,
    phone         text not null,            -- payer, international digits (2547..., 2519...)
    status        text not null default 'pending' check (status in ('pending','paid','partial','expired','cancelled')),
    paid_amount   numeric(12,2),
    created_at    timestamptz not null default now(),
    expires_at    timestamptz not null default now() + interval '2 hours',
    paid_at       timestamptz,
    payment_id    uuid,
    granted_until timestamptz
);
create index if not exists pay_requests_match on byo.pay_requests(method, status, created_at);
create index if not exists pay_requests_device on byo.pay_requests(device_key, created_at desc);
alter table byo.pay_requests enable row level security;

create table if not exists byo.pay_received (
    id            uuid primary key default gen_random_uuid(),
    method        text not null,
    txn_id        text not null,
    amount        numeric(12,2) not null,
    currency      text,
    payer_name    text,
    payer_masked  text,                      -- as shown in the SMS, e.g. 0114***089
    paid_at       timestamptz,
    received_at   timestamptz not null default now(),
    status        text not null,             -- matched | partial | unmatched | held
    request_id    uuid,
    device_key    text,
    note          text,
    raw           text,
    unique (method, txn_id)
);
create index if not exists pay_received_time on byo.pay_received(received_at desc);
alter table byo.pay_received enable row level security;

-- ---------------------------------------------------------------- helpers
-- Any phone form to international digits for the country code given ('254' or '251').
create or replace function byo._intl(p text, p_cc text) returns text language sql immutable as $$
    select case
        when d = '' then ''
        when d like p_cc || '%' then d
        when d like '0%' then p_cc || substr(d, 2)
        when length(d) = 9 then p_cc || d
        else d end
      from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create or replace function byo._cc(p_method text) returns text language sql immutable as $$
    select case when p_method = 'telebirr' then '251' else '254' end
$$;

-- Turn a TV on for N more days (on top of time it already has). A TV support has
-- disabled stays disabled: the payment is kept and shows in the console.
create or replace function byo._grant_days(p_device text, p_days int, p_by text, p_plan text, p_ref text)
returns timestamptz language plpgsql security definer set search_path = byo, public as $$
declare v_flags jsonb; v_acc jsonb; v_from timestamptz := now(); v_until timestamptz;
begin
    select flags into v_flags from byo.device_flags where device_key = p_device for update;
    v_acc := coalesce(v_flags->'access', 'null'::jsonb);
    if v_acc <> 'null'::jsonb and v_acc->>'state' = 'blocked' then return null; end if;
    if v_acc <> 'null'::jsonb and v_acc->>'state' = 'active' and (v_acc->>'until')::timestamptz > now() then
        v_from := (v_acc->>'until')::timestamptz;
    end if;
    v_until := v_from + make_interval(days => p_days);
    v_acc := jsonb_build_object('state','active','until', v_until, 'at', now(), 'by', p_by, 'paid', true, 'plan', p_plan, 'ref', p_ref);
    insert into byo.device_flags(device_key, flags, updated_at) values (p_device, jsonb_build_object('access', v_acc), now())
    on conflict (device_key) do update set flags = byo.device_flags.flags || jsonb_build_object('access', v_acc), updated_at = now();
    -- if support is connected to this TV, tell it straight away too
    insert into byo.support_commands(session_id, kind, payload, created_by)
    select ss.id, 'access.set', jsonb_build_object('access', v_acc, 'state', 'active', 'days', p_days), p_by
      from byo.support_sessions ss where ss.device_key = p_device and ss.status = 'connected';
    return v_until;
end; $$;
revoke all on function byo._grant_days(text,int,text,text,text) from public;

-- ---------------------------------------------------------------- TV side
create or replace function public.byo_pay_config(p_country text)
returns jsonb language plpgsql stable security definer set search_path = byo, public as $$
declare c jsonb; v_cc text := upper(coalesce(p_country, ''));
begin
    select cfg->v_cc into c from byo.pay_config where id = 1;
    if c is null then return jsonb_build_object('ok', true, 'country', v_cc, 'method', null, 'plans', '[]'::jsonb); end if;
    return jsonb_build_object('ok', true, 'country', v_cc, 'method', c->>'method', 'currency', c->>'currency',
        'number', c->>'number', 'name', c->>'name',
        'plans', coalesce((select jsonb_agg(jsonb_build_object('code', p->>'code', 'name', p->>'name', 'days', (p->>'days')::int, 'amount', (p->>'amount')::numeric))
                             from jsonb_array_elements(c->'plans') p where coalesce((p->>'on')::boolean, true)), '[]'::jsonb));
end; $$;

create or replace function public.byo_pay_start(p_device_key text, p_country text, p_plan text, p_phone text)
returns jsonb language plpgsql security definer set search_path = byo, public as $$
declare c jsonb; pl jsonb; v_cc text := upper(coalesce(p_country,'')); v_method text; v_phone text; v_id uuid; v_n int;
begin
    if coalesce(trim(p_device_key),'') = '' or length(p_device_key) > 120 then return jsonb_build_object('ok', false, 'error', 'bad device'); end if;
    select cfg->v_cc into c from byo.pay_config where id = 1;
    if c is null then return jsonb_build_object('ok', false, 'error', 'Payments are not available in your country yet.'); end if;
    v_method := c->>'method';
    if coalesce(c->>'number','') = '' then return jsonb_build_object('ok', false, 'error', 'Payments are being set up. Please try again soon.'); end if;
    select p into pl from jsonb_array_elements(c->'plans') p where p->>'code' = p_plan and coalesce((p->>'on')::boolean, true) limit 1;
    if pl is null then return jsonb_build_object('ok', false, 'error', 'That plan is not available. Choose another.'); end if;
    v_phone := byo._intl(p_phone, byo._cc(v_method));
    if v_method = 'mpesa' and v_phone !~ '^254[17][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'Enter your Safaricom M-Pesa number, like 0712 345 678.'); end if;
    if v_method = 'telebirr' and v_phone !~ '^251[79][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'Enter your telebirr number, like 0912 345 678.'); end if;
    select count(*) into v_n from byo.pay_requests where device_key = p_device_key and created_at > now() - interval '1 hour';
    if v_n >= 15 then return jsonb_build_object('ok', false, 'error', 'Too many tries. Please wait a few minutes.'); end if;
    -- one open request per TV: the newest choice wins
    update byo.pay_requests set status = 'cancelled' where device_key = p_device_key and status in ('pending','partial');
    insert into byo.pay_requests(device_key, country, method, currency, plan_code, plan_name, days, amount, phone)
    values (p_device_key, v_cc, v_method, c->>'currency', pl->>'code', pl->>'name', (pl->>'days')::int, (pl->>'amount')::numeric, v_phone)
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'method', v_method, 'currency', c->>'currency', 'amount', (pl->>'amount')::numeric,
        'plan', pl->>'name', 'days', (pl->>'days')::int, 'number', c->>'number', 'name', c->>'name', 'phone', v_phone,
        'expires_at', now() + interval '2 hours');
end; $$;

create or replace function public.byo_pay_status(p_device_key text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = byo, public as $$
declare r byo.pay_requests%rowtype; v_acc jsonb;
begin
    select * into r from byo.pay_requests where id = p_id and device_key = p_device_key;
    if not found then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
    if r.status = 'pending' and r.expires_at < now() then update byo.pay_requests set status = 'expired' where id = r.id; r.status := 'expired'; end if;
    select flags->'access' into v_acc from byo.device_flags where device_key = p_device_key;
    return jsonb_build_object('ok', true, 'status', r.status, 'plan', r.plan_name, 'amount', r.amount, 'paid_amount', r.paid_amount,
        'currency', r.currency, 'until', r.granted_until, 'access', case when r.status = 'paid' then v_acc else null end);
end; $$;

-- ---------------------------------------------------------------- collector side
-- p_items: [{ method:'mpesa'|'telebirr', txn, amount, currency, payer_name, payer_masked, paid_at, raw }]
create or replace function public.byo_collector_ingest(p_key text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public as $$
declare v_hash text; it jsonb; v_out jsonb := '[]'::jsonb; v_method text; v_txn text; v_amt numeric; v_mask text;
        v_pre text; v_suf text; r byo.pay_requests%rowtype; v_pid uuid; v_until timestamptz; v_res text; v_det text; v_by text;
begin
    select collector_key_hash into v_hash from byo.pay_config where id = 1;
    if v_hash is null then return jsonb_build_object('ok', false, 'error', 'Set a collector key in the support console first.'); end if;
    if byo._sha(coalesce(p_key, '')) <> v_hash then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;

    for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
        v_method := lower(coalesce(it->>'method', ''));
        v_txn := upper(left(coalesce(it->>'txn', ''), 40));
        begin v_amt := (it->>'amount')::numeric; exception when others then v_amt := null; end;
        v_mask := left(coalesce(it->>'payer_masked', ''), 40);
        if v_method not in ('mpesa','telebirr') or v_txn = '' or v_amt is null or v_amt <= 0 then
            v_out := v_out || jsonb_build_object('txn', v_txn, 'result', 'rejected', 'detail', 'missing method, reference or amount');
            continue;
        end if;
        if exists (select 1 from byo.pay_received where method = v_method and txn_id = v_txn) then
            v_out := v_out || (select jsonb_build_object('txn', v_txn, 'result', 'duplicate', 'detail', 'already received: ' || status, 'tv', upper(right(coalesce(device_key,''), 6)))
                               from byo.pay_received where method = v_method and txn_id = v_txn);
            continue;
        end if;

        -- payer digits the SMS shows: first part before the stars, last part after them
        v_pre := byo._intl(split_part(v_mask, '*', 1), byo._cc(v_method));
        v_suf := regexp_replace(regexp_replace(v_mask, '^.*\*', ''), '\D', '', 'g');
        if position('*' in v_mask) = 0 then v_suf := right(v_pre, 3); end if;

        select * into r from byo.pay_requests q
         where q.method = v_method and q.status in ('pending','partial') and q.expires_at > now() - interval '30 minutes'
           and length(v_suf) >= 3 and q.phone like '%' || v_suf
           and (length(v_pre) < 4 or q.phone like v_pre || '%')
         order by (q.amount <= v_amt) desc, case when q.amount <= v_amt then q.amount end desc nulls last, q.created_at desc
         limit 1;

        v_by := case when v_method = 'mpesa' then 'M-Pesa' else 'telebirr' end;
        if r.id is null then
            v_res := 'unmatched'; v_det := 'no TV is waiting for a payment from ' || coalesce(nullif(v_mask,''), 'this number');
        elsif v_amt < r.amount then
            v_res := 'partial'; v_det := 'paid ' || v_amt || ', the ' || r.plan_name || ' plan is ' || r.amount;
            update byo.pay_requests set status = 'partial', paid_amount = coalesce(paid_amount, 0) + v_amt where id = r.id;
        else
            v_until := byo._grant_days(r.device_key, r.days, v_by, r.plan_name, v_txn);
            if v_until is null then
                v_res := 'held'; v_det := 'TV ' || upper(right(r.device_key, 6)) || ' is disabled by support; payment kept';
            else
                v_res := 'matched'; v_det := r.plan_name || ' for TV ' || upper(right(r.device_key, 6)) || ', on until ' || to_char(v_until at time zone 'Africa/Nairobi', 'DD Mon HH24:MI');
            end if;
        end if;

        insert into byo.pay_received(method, txn_id, amount, currency, payer_name, payer_masked, paid_at, status, request_id, device_key, note, raw)
        values (v_method, v_txn, v_amt, coalesce(nullif(it->>'currency',''), case when v_method = 'telebirr' then 'ETB' else 'KES' end), left(it->>'payer_name', 80), v_mask,
                case when coalesce(it->>'paid_at','') ~ '^\d{4}-' then (it->>'paid_at')::timestamptz else null end,
                v_res, r.id, r.device_key, v_det, left(it->>'raw', 1000))
        returning id into v_pid;
        if v_res in ('matched','held') then
            update byo.pay_requests set status = 'paid', paid_amount = v_amt, paid_at = now(), payment_id = v_pid, granted_until = v_until where id = r.id;
        end if;
        v_out := v_out || jsonb_build_object('txn', v_txn, 'result', v_res, 'detail', v_det, 'tv', case when r.id is null then null else upper(right(r.device_key, 6)) end);
        r := null;
    end loop;
    return jsonb_build_object('ok', true, 'results', v_out);
end; $$;

-- The collector phone saves its receiving numbers here, so the TVs show them.
create or replace function public.byo_collector_numbers(p_key text, p_telebirr text default null, p_mpesa text default null)
returns jsonb language plpgsql security definer set search_path = byo, public as $$
declare v_hash text; v_tb text; v_mp text;
begin
    select collector_key_hash into v_hash from byo.pay_config where id = 1;
    if v_hash is null then return jsonb_build_object('ok', false, 'error', 'Set a collector key in the support console first.'); end if;
    if byo._sha(coalesce(p_key, '')) <> v_hash then return jsonb_build_object('ok', false, 'error', 'unauthorized'); end if;
    v_tb := byo._intl(p_telebirr, '251'); v_mp := byo._intl(p_mpesa, '254');
    if p_telebirr is not null and v_tb <> '' and v_tb !~ '^251[79][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'bad telebirr number'); end if;
    if p_mpesa is not null and v_mp <> '' and v_mp !~ '^254[17][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'bad M-Pesa number'); end if;
    update byo.pay_config set
        cfg = cfg
            || case when p_telebirr is null then '{}'::jsonb else jsonb_build_object('ET', (cfg->'ET') || jsonb_build_object('number', case when v_tb = '' then '' else '0' || substr(v_tb, 4) end)) end
            || case when p_mpesa is null then '{}'::jsonb else jsonb_build_object('KE', (cfg->'KE') || jsonb_build_object('number', case when v_mp = '' then '' else '0' || substr(v_mp, 4) end)) end,
        updated_at = now(), updated_by = 'collector phone'
     where id = 1;
    return jsonb_build_object('ok', true);
end; $$;

revoke all on function public.byo_pay_config(text) from public;
revoke all on function public.byo_pay_start(text,text,text,text) from public;
revoke all on function public.byo_pay_status(text,uuid) from public;
revoke all on function public.byo_collector_ingest(text,jsonb) from public;
revoke all on function public.byo_collector_numbers(text,text,text) from public;
grant execute on function public.byo_pay_config(text) to anon, authenticated;
grant execute on function public.byo_pay_start(text,text,text,text) to anon, authenticated;
grant execute on function public.byo_pay_status(text,uuid) to anon, authenticated;
grant execute on function public.byo_collector_ingest(text,jsonb) to anon, authenticated;
grant execute on function public.byo_collector_numbers(text,text,text) to anon, authenticated;

-- ---------------------------------------------------------------- console side
-- The support admin function from 0010 is kept as byo._support_admin_core; this wrapper
-- adds the payment actions in front of it.
do $$ begin
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'byo_support_admin' and position('pay-wrapper' in p.prosrc) = 0) then
        drop function if exists byo._support_admin_core(text, jsonb);
        alter function public.byo_support_admin(text, jsonb) rename to _support_admin_core;
        alter function public._support_admin_core(text, jsonb) set schema byo;
    end if;
end $$;
revoke all on function byo._support_admin_core(text, jsonb) from public, anon, authenticated;

create or replace function public.byo_support_admin(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = byo, public, extensions as $$
-- pay-wrapper: payment actions here, everything else goes to byo._support_admin_core
declare a jsonb := coalesce(p_args, '{}'::jsonb); v_agent text := left(coalesce(nullif(trim(a->>'agent'), ''), 'support'), 60);
        c jsonb; v_new jsonb := '{}'::jsonb; k text; pl jsonb; v_plans jsonb; v_num text; v_key text; v_n int;
begin
    if p_action = 'fleet.pay_config' then
        return (select jsonb_build_object('ok', true, 'cfg', cfg, 'collector_key_set', collector_key_hash is not null,
                       'updated_at', updated_at, 'updated_by', updated_by) from byo.pay_config where id = 1);
    end if;

    if p_action = 'fleet.pay_config_set' then
        c := a->'cfg';
        if c is null or jsonb_typeof(c) <> 'object' then return jsonb_build_object('ok', false, 'error', 'cfg required'); end if;
        for k in select jsonb_object_keys(c) loop
            if k not in ('KE','ET') then continue; end if;
            v_num := byo._intl(c->k->>'number', case when k = 'ET' then '251' else '254' end);
            if v_num <> '' and k = 'KE' and v_num !~ '^254[17][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'The Kenya M-Pesa number is not valid.'); end if;
            if v_num <> '' and k = 'ET' and v_num !~ '^251[79][0-9]{8}$' then return jsonb_build_object('ok', false, 'error', 'The Ethiopia telebirr number is not valid.'); end if;
            v_plans := '[]'::jsonb; v_n := 0;
            for pl in select * from jsonb_array_elements(coalesce(c->k->'plans', '[]'::jsonb)) loop
                v_n := v_n + 1;
                if v_n > 8 then exit; end if;
                if coalesce(pl->>'code','') !~ '^[a-z0-9_]{1,20}$' then return jsonb_build_object('ok', false, 'error', 'bad plan code'); end if;
                if length(trim(coalesce(pl->>'name',''))) not between 1 and 24 then return jsonb_build_object('ok', false, 'error', 'Each plan needs a name (up to 24 letters).'); end if;
                if coalesce((pl->>'days')::int, 0) not between 1 and 3650 then return jsonb_build_object('ok', false, 'error', 'Days must be between 1 and 3650.'); end if;
                if coalesce((pl->>'amount')::numeric, 0) <= 0 or (pl->>'amount')::numeric > 1000000 then return jsonb_build_object('ok', false, 'error', 'Each price must be more than 0.'); end if;
                v_plans := v_plans || jsonb_build_object('code', pl->>'code', 'name', trim(pl->>'name'), 'days', (pl->>'days')::int,
                    'amount', round((pl->>'amount')::numeric, 2), 'on', coalesce((pl->>'on')::boolean, true));
            end loop;
            v_new := v_new || jsonb_build_object(k, jsonb_build_object(
                'method', case when k = 'ET' then 'telebirr' else 'mpesa' end, 'currency', case when k = 'ET' then 'ETB' else 'KES' end,
                'number', case when v_num = '' then '' else '0' || substr(v_num, 4) end,
                'name', left(trim(coalesce(c->k->>'name','')), 40), 'plans', v_plans));
        end loop;
        update byo.pay_config set cfg = cfg || v_new, updated_at = now(), updated_by = v_agent where id = 1;
        insert into byo.support_audit(device_key, actor, action, detail) values (null, v_agent, 'pay.config', v_new);
        return (select jsonb_build_object('ok', true, 'cfg', cfg, 'collector_key_set', collector_key_hash is not null, 'updated_at', updated_at, 'updated_by', updated_by)
                  from byo.pay_config where id = 1);
    end if;

    if p_action = 'fleet.pay_key_new' then
        v_key := 'byoc_' || encode(gen_random_bytes(16), 'hex');
        update byo.pay_config set collector_key_hash = byo._sha(v_key), updated_at = now(), updated_by = v_agent where id = 1;
        insert into byo.support_audit(device_key, actor, action) values (null, v_agent, 'pay.key_new');
        return jsonb_build_object('ok', true, 'key', v_key);
    end if;

    if p_action = 'fleet.payments' then
        return jsonb_build_object('ok', true,
            'received', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'method', method, 'txn', txn_id, 'amount', amount, 'currency', currency,
                    'payer_name', payer_name, 'payer', payer_masked, 'at', received_at, 'status', status, 'note', note,
                    'tv_id', case when device_key is null then null else upper(right(device_key, 6)) end) order by received_at desc)
                from (select * from byo.pay_received order by received_at desc limit least(coalesce((a->>'limit')::int, 50), 200)) x), '[]'::jsonb),
            'waiting', coalesce((select jsonb_agg(jsonb_build_object('tv_id', upper(right(device_key, 6)), 'method', method, 'plan', plan_name,
                    'amount', amount, 'currency', currency, 'payer', '0' || substr(phone, 4, 3) || '***' || right(phone, 3), 'at', created_at, 'status', status) order by created_at desc)
                from (select * from byo.pay_requests where status in ('pending','partial') and expires_at > now() order by created_at desc limit 50) y), '[]'::jsonb),
            'today', (select jsonb_build_object('count', count(*), 'KES', coalesce(sum(amount) filter (where currency = 'KES'), 0), 'ETB', coalesce(sum(amount) filter (where currency = 'ETB'), 0))
                        from byo.pay_received where status in ('matched','held') and received_at > date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi'));
    end if;

    return byo._support_admin_core(p_action, p_args);
end; $$;
revoke all on function public.byo_support_admin(text, jsonb) from public, anon, authenticated;
grant execute on function public.byo_support_admin(text, jsonb) to service_role;
